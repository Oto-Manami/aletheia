// デモ版の窓口: 架空のデータを手元に持ち、承認などはその場で反映する（どこにも送らない）

import { type DraftInput, draftSchema } from "@aletheia/intake/draft";
import {
  type DemoIntake,
  demoIntakes,
  demoPageHtml,
  demoPosts,
  demoSnsPostHtml,
  placeholderImage,
  REFS,
} from "./demo-data.ts";
import { draftTitle, draftWarnings, reviewReasons } from "./summarize.ts";
import {
  type ArchiveSource,
  type Decision,
  type IntakeDetail,
  type IntakeIssue,
  type IntakeState,
  type IntakeSummary,
  type InviteView,
  type MemberView,
  type PostView,
  type RefLabel,
  type Role,
  type SearchHit,
  SourceError,
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
    };
  }

  viewer() {
    return Promise.resolve({
      name: "デモの運営者",
      isMember: true,
      isAdmin: true,
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
      item.draft = structuredClone(draft);
    }
    item.state = { approve: "approved", reject: "rejected", hold: "on_hold" }[
      decision
    ] as IntakeState;
    item.reviewNote = options.note ?? null;
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
      (m) => !(m.discordUserId === discordUserId && m.role === "viewer"),
    );
    if (this.members.length === before) throw new SourceError("外せる閲覧者がいません");
  }
}
