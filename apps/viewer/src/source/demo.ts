// デモ版の窓口: 架空のデータを手元に持ち、承認などはその場で反映する（どこにも送らない）

import { type DraftInput, draftSchema } from "@aletheia/intake/draft";
import {
  DEMO_GENERATION,
  DEMO_SUBJECT,
  DEMO_TAGS,
  type DemoIntake,
  type DemoTriage,
  demoIntakes,
  demoPageHtml,
  demoPosts,
  demoSnsPostHtml,
  demoTriage,
  placeholderImage,
  PEOPLE,
  REFS,
} from "./demo-data.ts";
import { onlyChosenImages } from "@aletheia/intake/images";
import { proposeSubjectLinks } from "@aletheia/intake/mentions";
import { draftTitle, draftWarnings, reviewReasons } from "./summarize.ts";
import { DemoEvents } from "./demo-events.ts";
import { bySignal, matchesMention, TRIAGE_FILTERS, triageItemOf } from "./triage.ts";
import {
  type ArchiveSource,
  type AssetCard,
  type AssetFilter,
  type Decision,
  type DiscardedItem,
  type EntityOption,
  type EventDetail,
  type EventInput,
  type IntakeDetail,
  type IntakeIssue,
  type IntakeState,
  type IntakeSummary,
  type InviteView,
  type MemberView,
  type NewEntity,
  type SourcePreview,
  type PostView,
  type RefLabel,
  type Role,
  type SearchHit,
  SourceError,
  type TriageCounts,
  type TriageMentionFilter,
  type TriageSort,
  type TriageSource,
} from "./types.ts";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** 一致した部分の前後を切り出し、一致した部分を囲む（データベースの検索の代わり） */
export function demoSnippet(text: string, query: string, width = 40): string | null {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return null;
  const from = Math.max(0, at - width);
  const to = Math.min(text.length, at + query.length + width);
  return (
    (from > 0 ? "…" : "") +
    escapeHtml(text.slice(from, at)) +
    `<span class="keyword">${escapeHtml(text.slice(at, at + query.length))}</span>` +
    escapeHtml(text.slice(at + query.length, to)) +
    (to < text.length ? "…" : "")
  );
}

function issuesOf(draft: unknown): IntakeIssue[] {
  const check = draftSchema.safeParse(draft);
  return check.success
    ? []
    : check.error.issues.map((i) => ({
        path: i.path.filter((p): p is string | number => typeof p !== "symbol"),
        message: i.message,
      }));
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DemoSource implements ArchiveSource {
  readonly demo = true;
  private intakes: DemoIntake[];
  private posts: PostView[];
  private previews = new Map<string, Record<string, string>>();
  private pageHtml = new Map<string, Record<string, string>>();
  private invites: (InviteView & { token: string })[] = [];
  private events = new DemoEvents();
  private discarded: { item: DemoTriage; at: string }[] = [];
  private triage: DemoTriage[] = demoTriage().map((t) => ({
    ...t,
    // 取り込みのときと同じ規則で、言及と画像の確認の候補を付ける
    draft: DEMO_TAGS.reduce(
      (d, tag) => proposeSubjectLinks(d, tag, { purpose: "tag" }),
      proposeSubjectLinks(proposeSubjectLinks(t.draft, DEMO_SUBJECT), DEMO_GENERATION),
    ),
  }));
  private members: MemberView[] = [
    {
      discordUserId: "100000000000000001",
      role: "admin",
      displayName: "デモの運営者",
      createdAt: "2026-10-25T10:00:00+09:00",
    },
    {
      discordUserId: "100000000000000002",
      role: "viewer",
      displayName: "試験 花子",
      createdAt: "2026-10-26T21:15:00+09:00",
    },
    {
      discordUserId: "100000000000000003",
      role: "worker",
      displayName: "見本 作業者",
      createdAt: "2026-10-27T20:00:00+09:00",
    },
  ];

  constructor(private readonly latencyMs = 120) {
    this.intakes = demoIntakes();
    this.posts = demoPosts();
    const hues = [200, 32, 160, 280, 340, 90];
    for (const item of this.intakes) {
      const map: Record<string, string> = {};
      const html: Record<string, string> = {};
      (item.draft.assets ?? []).forEach((a, i) => {
        if (a.media_type === "webpage") {
          const text = (item.draft.assets ?? [])
            .flatMap((x) => x.texts ?? [])
            .map((t) => t.content)
            .join("\n");
          html[a.ref] = item.channelKey.startsWith("x:")
            ? demoSnsPostHtml(item.channelName, text, item.draft.post.published_at ?? "")
            : demoPageHtml(item.draft.post.title ?? "（題名なし）", text);
          return;
        }
        if (a.media_type !== "image") return;
        const attrs = a.attributes ?? {};
        const label =
          typeof attrs.page_label === "string"
            ? attrs.page_label
            : attrs.page_from
              ? `p.${String(attrs.page_from)}${attrs.page_to ? `–${String(attrs.page_to)}` : ""}`
              : `写真 ${i}`;
        map[a.ref] = placeholderImage(
          label,
          hues[i % hues.length]!,
          attrs.page_to ? "spread" : "portrait",
        );
      });
      this.previews.set(item.id, map);
      this.pageHtml.set(item.id, html);
    }
  }

  private async delay(): Promise<void> {
    if (this.latencyMs > 0) await wait(this.latencyMs);
  }

  private summary(item: DemoIntake): IntakeSummary {
    return {
      id: item.id,
      channelKey: item.channelKey,
      channelName: item.channelName,
      externalId: item.externalId,
      route: item.route,
      capturedAt: item.capturedAt,
      state: item.state,
      title: draftTitle(item.draft),
      classification: item.draft.post.classification ?? null,
      availability: item.draft.post.availability ?? null,
      assetCount: (item.draft.assets ?? []).length,
      warningCount: draftWarnings(item.draft).length,
      reviewReasons: reviewReasons(item.draft),
      reviewedAt: item.reviewedAt ?? null,
      reviewedByName: item.reviewedAt ? "デモの運営者" : null,
    };
  }

  viewer() {
    return Promise.resolve({
      name: "デモの運営者",
      isMember: true,
      isAdmin: true,
      canWork: true,
      discordUserId: null,
    });
  }

  async listIntake(state: IntakeState): Promise<IntakeSummary[]> {
    await this.delay();
    return this.intakes
      .filter((i) => i.state === state)
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
      .map((i) => this.summary(i));
  }

  async countIntake(state: IntakeState): Promise<number> {
    await this.delay();
    if (state === "triage") return this.triage.length;
    return this.intakes.filter((i) => i.state === state).length;
  }

  private find(id: string): DemoIntake {
    const item = this.intakes.find((i) => i.id === id);
    if (!item) throw new SourceError("下書きが見つかりません", 404);
    return item;
  }

  async getIntake(id: string): Promise<IntakeDetail> {
    await this.delay();
    const item = this.find(id);
    const issues = issuesOf(item.draft);
    return {
      ...this.summary(item),
      draft: structuredClone(item.draft),
      draftValid: issues.length === 0,
      issues,
      reviewNote: item.reviewNote,
      previews: this.previews.get(id) ?? {},
      pageHtml: this.pageHtml.get(id) ?? {},
      channelAvailability: item.channelKey.startsWith("blog:") ? "free" : null,
      chosenImagesOnly: item.triaged === true,
    };
  }

  async decide(
    id: string,
    decision: Decision,
    options: { draft?: DraftInput; note?: string } = {},
  ): Promise<{ postId?: string }> {
    await this.delay();
    const item = this.find(id);
    if (item.state === "approved" || item.state === "rejected") {
      throw new SourceError("この下書きは既に判断済みです", 409);
    }
    if (decision === "approve") {
      const draft = options.draft ?? item.draft;
      const issues = issuesOf(draft);
      if (issues.length > 0) {
        throw new SourceError("下書きに直すところがあります", 422, issues);
      }
      // 振り分けで残したものは、写っている人を付けた画像だけを素材にする（API と同じ規則）
      item.draft = item.triaged
        ? onlyChosenImages(draftSchema.parse(draft))
        : structuredClone(draft);
    }
    item.state = { approve: "approved", reject: "rejected", hold: "on_hold" }[
      decision
    ] as IntakeState;
    item.reviewNote = options.note ?? null;
    item.reviewedAt = new Date().toISOString();
    const postId = this.posts[0]?.id;
    return decision === "approve" && postId ? { postId } : {};
  }

  labels(refs: { id: string; type: RefLabel["type"] }[]): Promise<RefLabel[]> {
    return Promise.resolve(
      refs.map(
        (r) =>
          REFS.find((x) => x.id === r.id && x.type === r.type) ?? {
            ...r,
            label: "（見つからない参照先）",
          },
      ),
    );
  }

  async findRefs(query: string): Promise<RefLabel[]> {
    await this.delay();
    const q = query.trim();
    return q ? REFS.filter((r) => r.label.includes(q)) : [];
  }

  async listTagCandidates(): Promise<RefLabel[]> {
    await this.delay();
    return REFS.filter((r) => r.type === "entity" && r.id !== PEOPLE.gen5);
  }

  async search(query: string): Promise<SearchHit[]> {
    await this.delay();
    const q = query.trim();
    if (!q) return [];
    const hits: SearchHit[] = [];
    for (const post of this.posts) {
      for (const asset of post.assets) {
        for (const text of asset.texts) {
          const snippetHtml = demoSnippet(text.content, q);
          if (snippetHtml) {
            hits.push({
              assetId: asset.id,
              postId: post.id,
              postTitle: post.title,
              channelName: post.channelName,
              date: post.publishedAt ?? post.publishedDate,
              textType: text.textType,
              snippetHtml,
            });
          }
        }
      }
    }
    return hits;
  }

  async listAssets(
    filter: AssetFilter,
    page: { offset: number; limit: number },
  ): Promise<{ items: AssetCard[]; hasMore: boolean }> {
    await this.delay();
    const type = filter.mediaType ?? "image";
    // デモ版では、投稿の「写っている」紐付けで人を絞る（本番はアセットごとの紐付け）
    const all = this.posts
      .filter((p) => !filter.channelId || p.channelName === filter.channelId)
      .filter(
        (p) =>
          !filter.personId ||
          p.links.some((l) => l.role === "appears" && l.target.id === filter.personId),
      )
      .flatMap((p) =>
        p.assets
          .filter((a) => type === "all" || a.mediaType === type)
          .map((a): AssetCard => ({
            id: a.id,
            postId: p.id,
            postTitle: p.title,
            channelName: p.channelName,
            publishedAt: p.publishedAt,
            publishedDate: p.publishedDate,
            mediaType: a.mediaType,
            title: a.title,
            imageUrl: a.mediaType === "image" ? a.previewUrl : null,
            openUrl: a.openUrl,
          })),
      )
      .sort((a, b) =>
        (b.publishedAt ?? b.publishedDate ?? "").localeCompare(
          a.publishedAt ?? a.publishedDate ?? "",
        ),
      );
    return {
      items: all.slice(page.offset, page.offset + page.limit),
      hasMore: all.length > page.offset + page.limit,
    };
  }

  async listChannels(): Promise<{ id: string; name: string }[]> {
    await this.delay();
    // デモ版では、情報源の名前を ID の代わりにする
    const names = [...new Set(this.posts.map((p) => p.channelName))].sort();
    return names.map((name) => ({ id: name, name }));
  }

  async getPost(id: string): Promise<PostView> {
    await this.delay();
    const post = this.posts.find((p) => p.id === id);
    if (!post) throw new SourceError("投稿が見つかりません", 404);
    return structuredClone(post);
  }

  async createInvite(note?: string) {
    await this.delay();
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const now = new Date();
    const invite = {
      id: crypto.randomUUID(),
      token,
      note: note?.trim() ? note.trim() : null,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
      usedAt: null,
      usedBy: null,
      usedByName: null,
      state: "open" as const,
    };
    this.invites.unshift(invite);
    return { id: invite.id, token, expiresAt: invite.expiresAt };
  }

  async listInvites(): Promise<InviteView[]> {
    await this.delay();
    // リンクの中の値は一覧に出さない
    return this.invites.map((i) => ({
      id: i.id,
      note: i.note,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      usedAt: i.usedAt,
      usedBy: i.usedBy,
      usedByName: i.usedByName,
      state: i.state,
    }));
  }

  async revokeInvite(id: string): Promise<void> {
    await this.delay();
    const invite = this.invites.find((i) => i.id === id && i.state === "open");
    if (!invite) throw new SourceError("取り消せる招待がありません");
    invite.state = "revoked";
  }

  async acceptInvite(token: string): Promise<Role> {
    await this.delay();
    const invite = this.invites.find((i) => i.token === token);
    if (!invite || invite.state !== "open") throw new SourceError("招待リンクが使えません");
    invite.state = "used";
    invite.usedAt = new Date().toISOString();
    return "viewer";
  }

  async listMembers(): Promise<MemberView[]> {
    await this.delay();
    return [...this.members];
  }

  async removeMember(discordUserId: string): Promise<void> {
    await this.delay();
    const before = this.members.length;
    this.members = this.members.filter(
      (m) => !(m.discordUserId === discordUserId && m.role !== "admin"),
    );
    if (this.members.length === before) throw new SourceError("外せる利用者がいません");
  }

  async setMemberRole(discordUserId: string, role: "worker" | "viewer"): Promise<void> {
    await this.delay();
    const member = this.members.find((m) => m.discordUserId === discordUserId);
    if (!member || member.role === "admin") {
      throw new SourceError(
        "切り替えられる利用者がいません（運営者は画面からは切り替えられません）",
      );
    }
    member.role = role;
  }

  async listTriage(
    options: { mention?: TriageMentionFilter; sort?: TriageSort; source?: TriageSource } = {},
  ) {
    await this.delay();
    const subjects = new Set([DEMO_SUBJECT.id]);
    const source = options.source ?? "all";
    const inSource = this.triage.filter(
      (t) => source === "all" || (source === "news") === (t.channelKind === "web"),
    );
    const all = inSource.map((t) =>
      triageItemOf(
        {
          id: t.id,
          channelName: t.channelName,
          capturedAt: t.capturedAt,
          draft: t.draft,
          channelKind: t.channelKind ?? "blog",
          previews: Object.fromEntries(
            Object.entries(t.photos).map(([ref, hue]) => [ref, placeholderImage(ref, hue)]),
          ),
        },
        subjects,
      ),
    );
    const counts = Object.fromEntries(
      TRIAGE_FILTERS.map((f) => [f, all.filter((i) => matchesMention(i, f)).length]),
    ) as TriageCounts;
    const mention = options.mention ?? "all";
    const items = all.filter((i) => matchesMention(i, mention));
    if (options.sort === "signal") items.sort(bySignal);
    return { items, total: counts[mention], counts };
  }

  async keepAndApprove(id: string, draft: DraftInput): Promise<void> {
    // 承認できない下書きなら、振り分け待ちのまま残す
    const issues = issuesOf(draft);
    if (issues.length > 0) throw new SourceError("下書きに直すところがあります", 422, issues);
    await this.keepTriage(id, draft);
    await this.decide(id, "approve", { draft });
  }

  async keepTriage(id: string, draft: DraftInput): Promise<void> {
    await this.delay();
    const item = this.triage.find((t) => t.id === id);
    if (!item) throw new SourceError("振り分け待ちの記事が見つかりません", 404);
    this.triage = this.triage.filter((t) => t.id !== id);
    this.intakes.push({
      id,
      channelKey: "blog:member",
      channelName: item.channelName,
      externalId: id.slice(-4),
      route: "fetch",
      capturedAt: item.capturedAt,
      state: "pending",
      reviewNote: null,
      triaged: true,
      draft,
    });
  }

  async listDiscarded(): Promise<DiscardedItem[]> {
    await this.delay();
    return this.discarded.map(({ item, at }) => ({
      id: item.id,
      channelName: item.channelName,
      title: item.draft.post.title ?? null,
      url: item.draft.post.url ?? null,
      discardedAt: at,
      discardedByName: "デモの運営者",
    }));
  }

  async restoreDiscarded(id: string): Promise<void> {
    await this.delay();
    const held = this.discarded.find((d) => d.item.id === id);
    if (!held) throw new SourceError("戻せる記事が見つかりません", 404);
    this.discarded = this.discarded.filter((d) => d.item.id !== id);
    this.triage = [...this.triage, held.item].sort((a, b) =>
      a.capturedAt.localeCompare(b.capturedAt),
    );
  }

  async discardTriage(ids: string[]) {
    await this.delay();
    const done = ids.filter((id) => this.triage.some((t) => t.id === id));
    // 言及なしにしたものは、直近 10 件まで置いておく（決定記録 0031）
    const now = Date.now();
    const moved = done.map((id, i) => ({
      item: this.triage.find((t) => t.id === id)!,
      at: new Date(now + i).toISOString(),
    }));
    this.discarded = [...moved.reverse(), ...this.discarded].slice(0, 10);
    this.triage = this.triage.filter((t) => !ids.includes(t.id));
    return {
      done,
      failed: ids.filter((id) => !done.includes(id)).map((id) => ({ id, error: "見つかりません" })),
    };
  }

  async listEvents(filter?: {
    query?: string;
    kind?: string;
    from?: string;
    to?: string;
    schedule?: "hide" | "include";
  }) {
    await this.delay();
    const linked = new Set(
      this.intakes.flatMap((i) =>
        (i.draft.links ?? []).filter((l) => l.to_type === "event").map((l) => l.to_id),
      ),
    );
    return this.events.list(filter, linked);
  }

  async getEvent(id: string): Promise<EventDetail> {
    await this.delay();
    // デモ版では、出来事に紐付けた下書き（承認待ち・承認済み）を、紐付いた素材として見せる
    const materials = this.intakes.flatMap((i) => {
      const link = (i.draft.links ?? []).find((l) => l.to_type === "event" && l.to_id === id);
      if (!link) return [];
      return [
        {
          postId: null,
          title: i.draft.post.title ?? null,
          url: i.draft.post.url ?? null,
          publishedAt: i.draft.post.published_at ?? null,
          publishedDate: i.draft.post.published_date ?? null,
          channelName: i.channelName,
          channelKind: i.channelKey.split(":")[0] ?? "other",
          role: link.role,
        },
      ];
    });
    return this.events.get(id, materials);
  }

  async saveEvent(id: string | null, input: EventInput): Promise<string> {
    await this.delay();
    return this.events.save(id, input);
  }

  async deleteEvent(id: string): Promise<void> {
    await this.delay();
    // デモ版では、承認待ち・承認済みの下書きの紐付けも、紐付いているものとして数える
    const linked = this.intakes.filter((i) =>
      (i.draft.links ?? []).some((l) => l.to_type === "event" && l.to_id === id),
    ).length;
    this.events.remove(id, linked);
  }

  async previewSource(url: string): Promise<SourcePreview | null> {
    await this.delay();
    // 書き方の違い（http・末尾の /・# 以降）はそろえて比べる
    const key = (u: string) =>
      u
        .trim()
        .replace(/#.*$/, "")
        .replace(/^https?:\/\//i, "")
        .replace(/\/$/, "");
    const post = this.posts.find((p) => p.url && key(p.url) === key(url));
    if (post) {
      return {
        state: "saved",
        postId: post.id,
        intakeId: null,
        title: post.title,
        channelName: post.channelName,
        publishedAt: post.publishedAt,
        publishedDate: post.publishedDate,
      };
    }
    const triage = this.triage.find((t) => t.draft.post.url && key(t.draft.post.url) === key(url));
    if (triage) {
      return {
        state: "triage",
        postId: null,
        intakeId: triage.id,
        title: triage.draft.post.title ?? null,
        channelName: triage.channelName,
        publishedAt: triage.draft.post.published_at ?? null,
        publishedDate: triage.draft.post.published_date ?? null,
      };
    }
    const intake = this.intakes.find(
      (i) =>
        i.draft.post.url &&
        key(i.draft.post.url) === key(url) &&
        (i.state === "pending" || i.state === "on_hold"),
    );
    if (!intake) return null;
    return {
      state: intake.state as SourcePreview["state"],
      postId: null,
      intakeId: intake.id,
      title: intake.draft.post.title ?? null,
      channelName: intake.channelName,
      publishedAt: intake.draft.post.published_at ?? null,
      publishedDate: intake.draft.post.published_date ?? null,
    };
  }

  async findEntities(query: string, types: readonly string[]): Promise<EntityOption[]> {
    await this.delay();
    return this.events.find(query, types);
  }

  async createEntity(entity: NewEntity) {
    await this.delay();
    return this.events.create(entity);
  }

  async listArchiveSubjects(): Promise<RefLabel[]> {
    await this.delay();
    return this.events.subjects();
  }
}
