// 本番の窓口: 読み取りはデータベース（ログインした利用者の権限）、承認などの書き込みは API
//
// データベースの行レベルセキュリティが見える範囲を決める。承認の画面は管理者だけが使える（API が確かめる）。

import type { DraftInput } from "@aletheia/intake/draft";
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftTitle, draftWarnings, reviewReasons } from "./summarize.ts";
import {
  type ArchiveSource,
  type AssetView,
  type Classification,
  type Decision,
  type IntakeDetail,
  type IntakeIssue,
  type IntakeState,
  type IntakeSummary,
  type InviteState,
  type InviteView,
  type MemberView,
  type PostView,
  type RefLabel,
  type Role,
  type SearchHit,
  SourceError,
  type Viewer,
} from "./types.ts";
import { INVITE_ERRORS } from "../invite.ts";

interface Result {
  data: unknown;
  error: { message: string } | null;
}

/** 招待・利用者の関数の失敗を、画面に出せる文にする */
function rpcRows<T>(res: Result): T[] {
  if (res.error) {
    const known = INVITE_ERRORS[res.error.message];
    throw new SourceError(known ?? `操作できませんでした: ${res.error.message}`);
  }
  return (res.data ?? []) as T[];
}

function rowsOf<T>(res: Result): T[] {
  if (res.error) throw new SourceError(`データを読めませんでした: ${res.error.message}`);
  return (res.data ?? []) as T[];
}

interface IntakeRow {
  id: string;
  channel_key: string;
  channel_name: string;
  external_id: string;
  route: string;
  captured_at: string;
  state: IntakeState;
  draft: DraftInput;
}

interface IntakeDetailRow {
  id: string;
  channel_id: string;
  external_id: string;
  route: string;
  captured_at: string;
  state: IntakeState;
  draft: DraftInput;
  review_note: string | null;
}

interface ChannelRow {
  id: string;
  key: string;
  name: string;
}

interface AssetRow {
  id: string;
  post_id: string | null;
  position: number | null;
  media_type: string;
  title: string | null;
  description: string | null;
  classification: Classification;
  attributes: Record<string, unknown>;
  asset_texts: { text_type: string; content: string }[];
  asset_files: {
    variant: string;
    provider: string;
    storage_key: string;
    byte_size: number | null;
  }[];
}

interface PostRow {
  id: string;
  title: string | null;
  published_at: string | null;
  published_date: string | null;
  published_date_precision: string | null;
  url: string | null;
  archived_url: string | null;
  captured_at: string | null;
  availability: string | null;
  classification: Classification;
  channels: { name: string; availability: string } | null;
}

/** 保存先で原本を開く URL（Drive は、権限のある人だけが開ける） */
export function openUrlOf(
  file: { provider: string; storage_key: string } | undefined,
): string | null {
  if (file?.provider === "gdrive") {
    return `https://drive.google.com/file/d/${encodeURIComponent(file.storage_key)}/view`;
  }
  return null;
}

function summarize(row: IntakeRow): IntakeSummary {
  return {
    id: row.id,
    channelKey: row.channel_key,
    channelName: row.channel_name,
    externalId: row.external_id,
    route: row.route,
    capturedAt: row.captured_at,
    state: row.state,
    title: draftTitle(row.draft),
    classification: row.draft.post?.classification ?? null,
    availability: row.draft.post?.availability ?? null,
    assetCount: (row.draft.assets ?? []).length,
    warningCount: draftWarnings(row.draft).length,
    reviewReasons: reviewReasons(row.draft),
  };
}

export class LiveSource implements ArchiveSource {
  readonly demo = false;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly apiUrl: string,
  ) {}

  private async api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const { data } = await this.supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new SourceError("ログインが必要です", 401);
    const res = await fetch(new URL(path, this.apiUrl), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      issues?: IntakeIssue[];
    };
    if (!res.ok) {
      throw new SourceError(
        json.error ?? `API の呼び出しに失敗しました（${res.status}）`,
        res.status,
        json.issues ?? [],
      );
    }
    return json as T;
  }

  async viewer(): Promise<Viewer> {
    const { data } = await this.supabase.auth.getUser();
    const user = data.user;
    const meta = user?.user_metadata as { full_name?: string; name?: string } | undefined;
    // 表示用。照合はデータベースが認証の記録で行う
    const discordUserId = user?.identities?.find((i) => i.provider === "discord")?.id ?? null;
    const [profile] = rowsOf<{ role: string; display_name: string | null }>(
      await this.supabase.rpc("my_profile"),
    );
    return {
      name: profile?.display_name ?? meta?.full_name ?? meta?.name ?? "ログイン中",
      isMember: profile !== undefined,
      isAdmin: profile?.role === "admin",
      discordUserId,
    };
  }

  async listIntake(state: IntakeState): Promise<IntakeSummary[]> {
    const { items } = await this.api<{ items: IntakeRow[] }>(
      "GET",
      `/intake?${new URLSearchParams({ state, limit: "200" }).toString()}`,
    );
    return items.map(summarize);
  }

  async getIntake(id: string): Promise<IntakeDetail> {
    const { item, draft_valid, issues } = await this.api<{
      item: IntakeDetailRow;
      draft_valid: boolean;
      issues: IntakeIssue[];
    }>("GET", `/intake/${encodeURIComponent(id)}`);
    const [channel] = rowsOf<ChannelRow>(
      await this.supabase.from("channels").select("id, key, name").eq("id", item.channel_id),
    );
    return {
      ...summarize({
        ...item,
        channel_key: channel?.key ?? "",
        channel_name: channel?.name ?? "（不明な情報源）",
      }),
      draft: item.draft,
      draftValid: draft_valid,
      issues,
      reviewNote: item.review_note,
      // 承認待ちのファイルの表示は、API がファイルを返せるようになってから
      previews: {},
      pageHtml: {},
    };
  }

  async decide(
    id: string,
    decision: Decision,
    options: { draft?: DraftInput; note?: string } = {},
  ): Promise<{ postId?: string }> {
    const body = {
      ...(options.note ? { note: options.note } : {}),
      ...(decision === "approve" && options.draft ? { draft: options.draft } : {}),
    };
    const res = await this.api<{ postId?: string }>(
      "POST",
      `/intake/${encodeURIComponent(id)}/${decision}`,
      body,
    );
    return res.postId ? { postId: res.postId } : {};
  }

  async labels(refs: { id: string; type: RefLabel["type"] }[]): Promise<RefLabel[]> {
    const byType = (type: RefLabel["type"]) => refs.filter((r) => r.type === type).map((r) => r.id);
    const found: RefLabel[] = [];
    const queries = [
      { type: "entity", table: "entities", column: "canonical_name" },
      { type: "event", table: "events", column: "title" },
      { type: "event_item", table: "event_items", column: "title" },
      { type: "term", table: "terms", column: "name" },
    ] as const;
    for (const q of queries) {
      const ids = byType(q.type);
      if (ids.length === 0) continue;
      const rows = rowsOf<Record<string, string>>(
        await this.supabase.from(q.table).select(`id, ${q.column}`).in("id", ids),
      );
      for (const row of rows) {
        found.push({ id: row["id"] ?? "", type: q.type, label: row[q.column] ?? "" });
      }
    }
    return refs.map(
      (r) =>
        found.find((f) => f.id === r.id && f.type === r.type) ?? {
          ...r,
          label: "（見つからない参照先）",
        },
    );
  }

  async findRefs(query: string): Promise<RefLabel[]> {
    const q = query.trim();
    if (!q) return [];
    const pattern = `%${q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
    const [entities, events] = await Promise.all([
      this.supabase
        .from("entities")
        .select("id, canonical_name")
        .ilike("canonical_name", pattern)
        .limit(10),
      this.supabase.from("events").select("id, title").ilike("title", pattern).limit(10),
    ]);
    return [
      ...rowsOf<{ id: string; canonical_name: string }>(entities).map((r) => ({
        id: r.id,
        type: "entity" as const,
        label: r.canonical_name,
      })),
      ...rowsOf<{ id: string; title: string }>(events).map((r) => ({
        id: r.id,
        type: "event" as const,
        label: r.title,
      })),
    ];
  }

  async search(query: string): Promise<SearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    const hits = rowsOf<{ asset_id: string; text_type: string; snippet: string }>(
      await this.supabase.rpc("search_texts", { query: q, max_rows: 50 }),
    );
    if (hits.length === 0) return [];
    const assets = rowsOf<{
      id: string;
      post_id: string | null;
      posts: {
        title: string | null;
        published_at: string | null;
        published_date: string | null;
        channels: { name: string } | null;
      } | null;
    }>(
      await this.supabase
        .from("assets")
        .select("id, post_id, posts(title, published_at, published_date, channels(name))")
        .in(
          "id",
          hits.map((h) => h.asset_id),
        ),
    );
    return hits.map((h) => {
      const a = assets.find((x) => x.id === h.asset_id);
      return {
        assetId: h.asset_id,
        postId: a?.post_id ?? null,
        postTitle: a?.posts?.title ?? null,
        channelName: a?.posts?.channels?.name ?? "",
        date: a?.posts?.published_at ?? a?.posts?.published_date ?? null,
        textType: h.text_type,
        snippetHtml: h.snippet,
      };
    });
  }

  async getPost(id: string): Promise<PostView> {
    const [post] = rowsOf<PostRow>(
      await this.supabase
        .from("posts")
        .select(
          "id, title, published_at, published_date, published_date_precision, url, archived_url, captured_at, availability, classification, channels(name, availability)",
        )
        .eq("id", id),
    );
    if (!post) throw new SourceError("投稿が見つかりません", 404);
    const assets = rowsOf<AssetRow>(
      await this.supabase
        .from("assets")
        .select(
          "id, post_id, position, media_type, title, description, classification, attributes, asset_texts(text_type, content), asset_files(variant, provider, storage_key, byte_size)",
        )
        .eq("post_id", id)
        .order("position"),
    );
    const links = rowsOf<{ role: string; to_type: RefLabel["type"]; to_id: string }>(
      await this.supabase
        .from("links")
        .select("role, to_type, to_id")
        .eq("review_state", "accepted")
        .or(
          [
            `and(from_type.eq.post,from_id.eq.${id})`,
            ...assets.map((a) => `and(from_type.eq.asset,from_id.eq.${a.id})`),
          ].join(","),
        ),
    );
    const labels = await this.labels(links.map((l) => ({ id: l.to_id, type: l.to_type })));
    const assetViews: AssetView[] = assets.map((a) => ({
      id: a.id,
      position: a.position,
      mediaType: a.media_type,
      title: a.title,
      description: a.description,
      classification: a.classification,
      attributes: a.attributes,
      texts: a.asset_texts.map((t) => ({ textType: t.text_type, content: t.content })),
      // 画像そのものの表示は、API がファイルを返せるようになってから
      previewUrl: null,
      openUrl: openUrlOf(a.asset_files.find((f) => f.variant === "original")),
      stored: a.asset_files.some((f) => f.variant === "original"),
      byteSize: a.asset_files.find((f) => f.variant === "original")?.byte_size ?? null,
      inlineHtml: null,
    }));
    return {
      id: post.id,
      title: post.title,
      channelName: post.channels?.name ?? "",
      publishedAt: post.published_at,
      publishedDate: post.published_date,
      publishedDatePrecision: post.published_date_precision,
      url: post.url,
      archivedUrl: post.archived_url,
      capturedAt: post.captured_at,
      availability: post.availability ?? post.channels?.availability ?? null,
      classification: post.classification,
      assets: assetViews,
      links: links.map((l, i) => ({ role: l.role, target: labels[i]! })),
    };
  }

  async createInvite(note?: string) {
    const [row] = rpcRows<{ id: string; token: string; expires_at: string }>(
      await this.supabase.rpc("create_invite", { note: note ?? null }),
    );
    if (!row) throw new SourceError("招待を作れませんでした");
    return { id: row.id, token: row.token, expiresAt: row.expires_at };
  }

  async listInvites(): Promise<InviteView[]> {
    const rows = rpcRows<{
      id: string;
      note: string | null;
      created_at: string;
      expires_at: string;
      used_at: string | null;
      used_by: string | null;
      used_by_name: string | null;
      state: InviteState;
    }>(await this.supabase.rpc("list_invites"));
    return rows.map((r) => ({
      id: r.id,
      note: r.note,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      usedAt: r.used_at,
      usedBy: r.used_by,
      usedByName: r.used_by_name,
      state: r.state,
    }));
  }

  async revokeInvite(id: string): Promise<void> {
    rpcRows(await this.supabase.rpc("revoke_invite", { invite_id: id }));
  }

  async acceptInvite(token: string): Promise<Role> {
    const res = await this.supabase.rpc("accept_invite", { token });
    rpcRows(res);
    return res.data as Role;
  }

  async listMembers(): Promise<MemberView[]> {
    const rows = rpcRows<{
      discord_user_id: string;
      role: Role;
      display_name: string | null;
      created_at: string;
    }>(await this.supabase.rpc("list_members"));
    return rows.map((r) => ({
      discordUserId: r.discord_user_id,
      role: r.role,
      displayName: r.display_name,
      createdAt: r.created_at,
    }));
  }

  async removeMember(discordUserId: string): Promise<void> {
    rpcRows(await this.supabase.rpc("remove_member", { member_discord_user_id: discordUserId }));
  }
}
