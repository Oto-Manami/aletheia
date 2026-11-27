// 本番の窓口: 読み取りはデータベース（ログインした利用者の権限）、承認などの書き込みは API
//
// データベースの行レベルセキュリティが見える範囲を決める。承認の画面は管理者だけが使える（API が確かめる）。

import { versionWatcher } from "../version.ts";
import { clearLoadCache } from "../load-cache.ts";
import type { DraftInput } from "@aletheia/intake/draft";
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftTitle, draftWarnings, reviewReasons } from "./summarize.ts";
import { triageItemOf } from "./triage.ts";
import type { EpisodeRow } from "./regular.ts";
import {
  type Dashboard,
  type WorkSummary,
  type WorkView,
  type DashboardEvent,
  type ApproveOutcome,
  type ArticleDay,
  type ArchiveSource,
  type AssetCard,
  type AssetFilter,
  type AssetView,
  type Classification,
  type Decision,
  type DiscardedItem,
  type EntityOption,
  type EventArticleView,
  type EventSetlistsView,
  type EventDetail,
  type EventInput,
  type EventSummary,
  type NewEntity,
  type SourcePreview,
  type ParticipantStatus,
  type IntakeDetail,
  type ItemParticipation,
  type IntakeSort,
  type IntakeFile,
  type IntakeIssue,
  type IntakeKindCount,
  type ImageSimilarity,
  type DuplicatePair,
  type SimilarAsset,
  type IntakeState,
  type IntakeSummary,
  type InviteState,
  type InviteView,
  type MemberView,
  type PostTitleHit,
  type PostEdit,
  type PostView,
  type RefLabel,
  type Role,
  type SearchHit,
  type SetlistItem,
  type SongDetail,
  type SongImportResult,
  type SongList,
  SourceError,
  type MenuCounts,
  type TriageCounts,
  type TriageItem,
  type TriageMentionFilter,
  type TriageSort,
  type TriageSource,
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
  /** 情報源の種類（決定記録 0068） */
  channel_kind?: string;
  id: string;
  channel_key: string;
  channel_name: string;
  external_id: string;
  route: string;
  captured_at: string;
  state: IntakeState;
  draft: DraftInput;
  reviewed_at?: string | null;
  reviewed_by_name?: string | null;
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
  reviewed_at?: string | null;
  reviewed_by_name?: string | null;
  staged_files?: unknown;
}

interface ChannelRow {
  id: string;
  key: string;
  name: string;
  kind?: string;
  availability?: string;
  owner_entity_id?: string | null;
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
  file_policy?: string;
  asset_texts: { text_type: string; content: string }[];
  asset_files: {
    variant: string;
    provider: string;
    storage_key: string;
    byte_size: number | null;
  }[];
}

/** 承認の API の応答（必要なところだけ） */
interface ApproveResponse {
  postId?: string;
  files?: { failed: unknown[] } | null;
}

function approveOutcome(res: ApproveResponse): ApproveOutcome {
  const failed = res.files?.failed.length ?? 0;
  return {
    ...(res.postId ? { postId: res.postId } : {}),
    ...(failed > 0 ? { filesFailed: failed } : {}),
  };
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

/** 保存先で動画を再生する URL（画面に重ねて出す。Drive は、権限のある人だけが見られる） */
export function playUrlOf(
  file: { provider: string; storage_key: string } | undefined,
): string | null {
  if (file?.provider === "gdrive") {
    return `https://drive.google.com/file/d/${encodeURIComponent(file.storage_key)}/preview`;
  }
  return null;
}

/** 下書きの動画ごとの、仮置きのファイルを保存先で再生する URL */
export function stagedPlayUrls(draft: DraftInput, stagedFiles: unknown): Record<string, string> {
  const staged = (Array.isArray(stagedFiles) ? stagedFiles : []).flatMap((f: unknown) => {
    const o = f as { provider?: unknown; storage_key?: unknown; sha256?: unknown } | null;
    return o &&
      typeof o.provider === "string" &&
      typeof o.storage_key === "string" &&
      typeof o.sha256 === "string"
      ? [{ provider: o.provider, storage_key: o.storage_key, sha256: o.sha256 }]
      : [];
  });
  const urls: Record<string, string> = {};
  for (const a of draft.assets ?? []) {
    if (a.media_type !== "video" || !a.sha256) continue;
    const url = playUrlOf(staged.find((s) => s.sha256 === a.sha256));
    if (url) urls[a.ref] = url;
  }
  return urls;
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

interface SimilarAssetRow {
  asset_id: string;
  width: number | null;
  height: number | null;
  post_id: string | null;
  post_title: string | null;
  published_at: string | null;
  channel_name: string | null;
  channel_kind: string | null;
}

function similarAssetOf(r: SimilarAssetRow): SimilarAsset {
  return {
    assetId: r.asset_id,
    width: r.width,
    height: r.height,
    postId: r.post_id,
    postTitle: r.post_title,
    publishedAt: r.published_at,
    channelName: r.channel_name,
    channelKind: r.channel_kind,
  };
}

function summarize(row: IntakeRow): IntakeSummary {
  return {
    id: row.id,
    channelKey: row.channel_key,
    channelName: row.channel_name,
    channelKind: row.channel_kind ?? null,
    externalId: row.external_id,
    route: row.route,
    capturedAt: row.captured_at,
    publishedAt: row.draft.post?.published_at ?? null,
    publishedDate: row.draft.post?.published_date ?? null,
    state: row.state,
    title: draftTitle(row.draft),
    classification: row.draft.post?.classification ?? null,
    availability: row.draft.post?.availability ?? null,
    assetCount: (row.draft.assets ?? []).length,
    warningCount: draftWarnings(row.draft).length,
    reviewReasons: reviewReasons(row.draft),
    reviewedAt: row.reviewed_at ?? null,
    reviewedByName: row.reviewed_by_name ?? null,
  };
}

/** 振り分け待ちを一度に読む件数 */
const TRIAGE_PAGE = 50;

export class LiveSource implements ArchiveSource {
  readonly demo = false;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly apiUrl: string,
  ) {}

  private async api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    // 古い版の画面のまま書き込まない（新しい API と食い違うおそれがある。Issue #73）
    if (method === "POST") await versionWatcher.assertCurrent();
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
    // 変えたら、覚えた画面のデータを捨てる（決定記録 0062）
    if (method !== "GET") clearLoadCache();
    return json as T;
  }

  /** 縮めた画像を同時に読む数（保存先に負担をかけない） */
  private thumbnailSlots = 6;
  private readonly thumbnailWaiters: (() => void)[] = [];
  /**
   * 読んだ縮めた画像を、タブを開いている間だけ覚える（決定記録 0062）。メモリにだけ持ち、数に上限を置く。
   * 縮めた画像は素材ごとに変わらないので、変更をしても捨てない
   */
  private readonly thumbnailBlobs = new Map<string, Blob>();
  private static readonly THUMBNAIL_LIMIT = 600;

  async assetThumbnail(assetId: string): Promise<{ url: string; release: () => void } | null> {
    const known = this.thumbnailBlobs.get(assetId);
    if (known) {
      this.thumbnailBlobs.delete(assetId);
      this.thumbnailBlobs.set(assetId, known);
      const url = URL.createObjectURL(known);
      return { url, release: () => URL.revokeObjectURL(url) };
    }
    if (this.thumbnailSlots === 0) {
      await new Promise<void>((resolve) => this.thumbnailWaiters.push(resolve));
    } else {
      this.thumbnailSlots--;
    }
    try {
      const blob = await this.apiBlob(`/assets/${encodeURIComponent(assetId)}/thumbnail`);
      this.thumbnailBlobs.set(assetId, blob);
      while (this.thumbnailBlobs.size > LiveSource.THUMBNAIL_LIMIT) {
        const oldest = this.thumbnailBlobs.keys().next().value;
        if (oldest === undefined) break;
        this.thumbnailBlobs.delete(oldest);
      }
      const url = URL.createObjectURL(blob);
      return { url, release: () => URL.revokeObjectURL(url) };
    } catch {
      return null;
    } finally {
      const next = this.thumbnailWaiters.shift();
      if (next) next();
      else this.thumbnailSlots++;
    }
  }

  async assetOriginal(assetId: string): Promise<{ url: string; release: () => void } | null> {
    try {
      const blob = await this.apiBlob(`/assets/${encodeURIComponent(assetId)}/original`);
      const url = URL.createObjectURL(blob);
      return { url, release: () => URL.revokeObjectURL(url) };
    } catch {
      return null;
    }
  }

  /** API からファイルの中身を読む */
  private async apiBlob(path: string): Promise<Blob> {
    const { data } = await this.supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new SourceError("ログインが必要です", 401);
    const res = await fetch(new URL(path, this.apiUrl), {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new SourceError(`ファイルを読めませんでした（${res.status}）`, res.status);
    return res.blob();
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
      canWork: profile?.role === "admin" || profile?.role === "worker",
      discordUserId,
    };
  }

  async listIntake(
    state: IntakeState,
    sort: IntakeSort = "default",
    kind?: string,
  ): Promise<IntakeSummary[]> {
    const { items } = await this.api<{ items: IntakeRow[] }>(
      "GET",
      `/intake?${new URLSearchParams({ state, limit: "200", sort, ...(kind ? { kind } : {}) }).toString()}`,
    );
    return items.map(summarize);
  }

  async similarImages(intakeId: string): Promise<ImageSimilarity[]> {
    const { items } = await this.api<{
      items: { ref: string; matches: (SimilarAssetRow & { distance: number })[] }[];
    }>("GET", `/intake/${encodeURIComponent(intakeId)}/similar`);
    return items.map((i) => ({
      ref: i.ref,
      matches: i.matches.map((m) => ({ ...similarAssetOf(m), distance: m.distance })),
    }));
  }

  async listDuplicates(): Promise<{ total: number; items: DuplicatePair[] }> {
    const r = await this.api<{
      total: number;
      items: {
        id: string;
        distance: number | null;
        left: SimilarAssetRow;
        right: SimilarAssetRow;
      }[];
    }>("GET", "/duplicates");
    return {
      total: r.total,
      items: r.items.map((p) => ({
        id: p.id,
        distance: p.distance,
        left: similarAssetOf(p.left),
        right: similarAssetOf(p.right),
      })),
    };
  }

  async decideDuplicate(id: string, decision: "same" | "distinct"): Promise<void> {
    await this.api("POST", `/duplicates/${encodeURIComponent(id)}`, { decision });
  }

  async intakeKinds(state: IntakeState): Promise<IntakeKindCount[]> {
    const { kinds } = await this.api<{ kinds?: IntakeKindCount[] }>(
      "GET",
      `/intake?${new URLSearchParams({ state, limit: "1" }).toString()}`,
    );
    return kinds ?? [];
  }

  async countIntake(state: IntakeState): Promise<number> {
    const { total } = await this.api<{ total: number }>(
      "GET",
      `/intake?${new URLSearchParams({ state, limit: "1" }).toString()}`,
    );
    return total;
  }

  menuCounts(): Promise<MenuCounts> {
    return this.api<MenuCounts>("GET", "/intake/counts");
  }

  async getIntake(id: string): Promise<IntakeDetail> {
    const { item, draft_valid, issues, chosen_images_only, undoable } = await this.api<{
      item: IntakeDetailRow;
      draft_valid: boolean;
      issues: IntakeIssue[];
      chosen_images_only?: boolean;
      undoable?: boolean;
    }>("GET", `/intake/${encodeURIComponent(id)}`);
    const [channel] = rowsOf<ChannelRow>(
      await this.supabase
        .from("channels")
        .select("id, key, name, kind, availability, owner_entity_id")
        .eq("id", item.channel_id),
    );
    return {
      ...summarize({
        ...item,
        channel_key: channel?.key ?? "",
        channel_name: channel?.name ?? "（不明な情報源）",
        ...(channel?.kind ? { channel_kind: channel.kind } : {}),
      }),
      draft: item.draft,
      draftValid: draft_valid,
      issues,
      reviewNote: item.review_note,
      // 取り込んだファイルは数が多く大きいので、別に読む（loadIntakeFiles）
      previews: {},
      pageHtml: {},
      playUrls: stagedPlayUrls(item.draft, item.staged_files),
      channelAvailability: channel?.availability ?? null,
      channelOwnerId: channel?.owner_entity_id ?? null,
      chosenImagesOnly: chosen_images_only === true,
      undoable: undoable === true,
    };
  }

  loadIntakeFiles(detail: IntakeDetail, onFile: (file: IntakeFile) => void): () => void {
    // 取り込んだファイルがある素材（SHA-256 が付いている画像と、保存した Web ページ）と、動画の表紙の画像
    const targets = (detail.draft.assets ?? []).flatMap((a) => {
      const poster = a.attributes?.["poster_sha256"];
      if (a.media_type === "video" && typeof poster === "string") {
        return [{ ref: a.ref, sha256: poster, page: false }];
      }
      return a.sha256 && (a.media_type === "image" || a.media_type === "webpage")
        ? [{ ref: a.ref, sha256: a.sha256, page: a.media_type === "webpage" }]
        : [];
    });
    const urls: string[] = [];
    let stopped = false;
    const next = async (): Promise<void> => {
      for (let t = targets.shift(); t && !stopped; t = targets.shift()) {
        try {
          const blob = await this.apiBlob(
            `/intake/${encodeURIComponent(detail.id)}/files/${t.sha256}`,
          );
          if (stopped) return;
          if (t.page) {
            onFile({ ref: t.ref, html: await blob.text() });
          } else {
            const url = URL.createObjectURL(blob);
            urls.push(url);
            onFile({ ref: t.ref, previewUrl: url });
          }
        } catch {
          // 読めないファイル（片付けた後・保存先に届かない）は、表示しないだけ
        }
      }
    };
    // 保存先に負担をかけないよう、同時に読むのは 4 つまで
    for (let i = 0; i < 4; i++) void next();
    return () => {
      stopped = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }

  async getEventArticle(eventId: string): Promise<EventArticleView> {
    const res = await this.api<{
      article: {
        body: string;
        sections: {
          days?: {
            date: string;
            outfit_note: string;
            outfit_assets: string[];
            content: string;
            streams: { url: string; title: string; note: string }[];
          }[];
        };
        updated_at: string;
        author_name: string | null;
      } | null;
    }>("GET", `/events/${encodeURIComponent(eventId)}/article`);
    return {
      article: res.article
        ? {
            body: res.article.body,
            days: (res.article.sections.days ?? []).map((d) => ({
              date: d.date,
              outfitNote: d.outfit_note,
              outfitAssets: d.outfit_assets,
              content: d.content,
              streams: d.streams,
            })),
            updatedAt: res.article.updated_at,
            authorName: res.article.author_name,
          }
        : null,
    };
  }

  async getEventSetlists(eventId: string): Promise<EventSetlistsView> {
    const res = await this.api<{
      subject: { id: string; name: string } | null;
      has_schedule: boolean;
      setlists: {
        event_id: string;
        title: string | null;
        starts_on: string | null;
        part: string | null;
        is_schedule: boolean;
        is_legacy: boolean;
        items: {
          id: string;
          item_type: string;
          work_id: string | null;
          work_name: string | null;
          title: string | null;
          note: string | null;
          subject_status: ItemParticipation;
        }[];
      }[];
    }>("GET", `/events/${encodeURIComponent(eventId)}/setlists`);
    return {
      subject: res.subject,
      hasSchedule: res.has_schedule,
      setlists: res.setlists.map((s) => ({
        eventId: s.event_id,
        title: s.title,
        startsOn: s.starts_on,
        part: s.part,
        isSchedule: s.is_schedule,
        isLegacy: s.is_legacy,
        items: s.items.map((i) => ({
          id: i.id,
          itemType: i.item_type,
          workId: i.work_id,
          workName: i.work_name,
          title: i.title,
          note: i.note,
          subjectStatus: i.subject_status,
        })),
      })),
    };
  }

  async setItemParticipation(
    itemId: string,
    entityId: string,
    status: ItemParticipation,
  ): Promise<void> {
    await this.api("POST", `/event-items/${encodeURIComponent(itemId)}/participants`, {
      entity_id: entityId,
      status,
    });
  }

  async saveEventArticle(
    eventId: string,
    article: { body: string; days: ArticleDay[] },
  ): Promise<void> {
    await this.api("POST", `/events/${encodeURIComponent(eventId)}/article`, {
      body: article.body,
      sections: {
        days: article.days.map((d) => ({
          date: d.date,
          outfit_note: d.outfitNote,
          outfit_assets: d.outfitAssets,
          content: d.content,
          streams: d.streams,
        })),
      },
    });
  }

  async saveEventItems(eventId: string, items: SetlistItem[]): Promise<void> {
    await this.api("POST", `/events/${encodeURIComponent(eventId)}/items`, {
      items: items.map((i) => ({
        id: i.id,
        item_type: i.itemType,
        work_id: i.workId,
        title: i.workId ? null : i.title,
        note: i.note,
      })),
    });
  }

  async getDashboard(): Promise<Dashboard> {
    interface Ev {
      id: string;
      title: string | null;
      parent_id: string | null;
      parent_title: string | null;
      starts_on: string | null;
      songs?: number;
    }
    const ev = (e: Ev): DashboardEvent => ({
      id: e.id,
      title: e.title,
      parentId: e.parent_id,
      parentTitle: e.parent_title,
      startsOn: e.starts_on,
      ...(e.songs !== undefined ? { songs: e.songs } : {}),
    });
    const r = await this.api<{
      subject: { id: string; name: string } | null;
      tasks: null | {
        pending: number;
        pending_oldest: string | null;
        triage: { blog: number; news: number };
        missing_files: {
          count: number;
          posts: { id: string; title: string | null; published_at: string | null; files: number }[];
        };
        unknown_participation: { count: number; events: Ev[] } | null;
        setlist_missing: { count: number; events: Ev[] } | null;
        overdue: { count: number; events: Ev[] };
        similar_images?: { count: number; unhashed: number };
      };
      data: {
        posts: { channel_id: string; name: string; kind: string; count: number }[];
        assets: { media_type: string; count: number }[];
        events: { kind: string; count: number }[];
        schedules: number;
        people: number;
        songs: number;
        posts_range: { oldest: string | null; newest: string | null };
      };
      recent: {
        days: { date: string; approved: number; rejected: number; discarded: number }[];
        approved: {
          post_id: string | null;
          title: string | null;
          channel: string;
          reviewed_at: string;
        }[];
      };
    }>("GET", "/dashboard");
    const t = r.tasks;
    return {
      subject: r.subject,
      tasks: t && {
        pending: t.pending,
        pendingOldest: t.pending_oldest,
        triage: t.triage,
        missingFiles: {
          count: t.missing_files.count,
          posts: t.missing_files.posts.map((p) => ({
            id: p.id,
            title: p.title,
            publishedAt: p.published_at,
            files: p.files,
          })),
        },
        unknownParticipation: t.unknown_participation && {
          count: t.unknown_participation.count,
          events: t.unknown_participation.events.map(ev),
        },
        setlistMissing: t.setlist_missing && {
          count: t.setlist_missing.count,
          events: t.setlist_missing.events.map(ev),
        },
        overdue: { count: t.overdue.count, events: t.overdue.events.map(ev) },
        similarImages: t.similar_images ?? { count: 0, unhashed: 0 },
      },
      data: {
        posts: r.data.posts.map((p) => ({
          channelId: p.channel_id,
          name: p.name,
          kind: p.kind,
          count: p.count,
        })),
        assets: r.data.assets.map((a) => ({ mediaType: a.media_type, count: a.count })),
        events: r.data.events,
        schedules: r.data.schedules,
        people: r.data.people,
        songs: r.data.songs,
        postsRange: r.data.posts_range,
      },
      recent: {
        days: r.recent.days,
        approved: r.recent.approved.map((a) => ({
          postId: a.post_id,
          title: a.title,
          channel: a.channel,
          reviewedAt: a.reviewed_at,
        })),
      },
    };
  }

  async listSongs(): Promise<SongList> {
    const res = await this.api<{
      releases: {
        id: string;
        subtype: string;
        name: string;
        released_on: string | null;
        tracks: {
          song_id: string;
          name: string;
          position: number | null;
          is_title: boolean;
          editions: string[];
        }[];
      }[];
      songs: {
        id: string;
        name: string;
        performed: number;
        appeared: number;
        not_appearing: number;
        in_release: boolean;
      }[];
      subject: { id: string; name: string } | null;
    }>("GET", "/songs");
    return {
      subject: res.subject,
      releases: res.releases.map((r) => ({
        id: r.id,
        subtype: r.subtype,
        name: r.name,
        releasedOn: r.released_on,
        tracks: r.tracks.map((t) => ({
          songId: t.song_id,
          name: t.name,
          position: t.position,
          isTitle: t.is_title,
          editions: t.editions,
        })),
      })),
      songs: res.songs.map((s) => ({
        id: s.id,
        name: s.name,
        performed: s.performed,
        appeared: s.appeared,
        notAppearing: s.not_appearing,
        inRelease: s.in_release,
      })),
    };
  }

  async listWorks(filter: { subtype?: string; query?: string }): Promise<WorkSummary[]> {
    const params = new URLSearchParams();
    if (filter.subtype) params.set("subtype", filter.subtype);
    if (filter.query?.trim()) params.set("q", filter.query.trim());
    const { items } = await this.api<{ items: WorkSummary[] }>(
      "GET",
      `/works${params.size > 0 ? `?${params.toString()}` : ""}`,
    );
    return items;
  }

  async addWorkEpisodes(id: string, episodes: EpisodeRow[], dryRun: boolean) {
    return this.api<{
      created: { index: number; id: string | null; title: string }[];
      skipped: { index: number; reason: string }[];
    }>("POST", `/works/${encodeURIComponent(id)}/episodes`, { episodes, dry_run: dryRun });
  }

  async setWorkRegular(id: string, regular: boolean): Promise<void> {
    await this.api("POST", `/works/${encodeURIComponent(id)}/regular`, { regular });
  }

  async getWork(id: string): Promise<WorkView> {
    const r = await this.api<{
      work: {
        id: string;
        name: string;
        subtype: string | null;
        reading: string | null;
        regular: boolean;
      };
      subject: { id: string; name: string } | null;
      events: {
        id: string;
        title: string | null;
        kind: string;
        starts_on: string | null;
        date_precision: string | null;
        episode_number: number | null;
        parent_id: string | null;
        subject_status: string | null;
        materials: number;
      }[];
      images: {
        asset_id: string;
        file_asset_id: string | null;
        post_id: string;
        post_title: string | null;
        published_at: string | null;
        published_date: string | null;
        channel_name: string;
        event_id: string | null;
        event_title: string | null;
        event_starts_on: string | null;
        subject_appears: boolean;
      }[];
      more_images: boolean;
    }>("GET", `/works/${encodeURIComponent(id)}`);
    return {
      work: r.work,
      subject: r.subject,
      events: r.events.map((e) => ({
        id: e.id,
        title: e.title,
        kind: e.kind,
        startsOn: e.starts_on,
        datePrecision: e.date_precision,
        episodeNumber: e.episode_number,
        parentId: e.parent_id,
        subjectStatus: e.subject_status,
        materials: e.materials,
      })),
      images: r.images.map((i) => ({
        assetId: i.asset_id,
        fileAssetId: i.file_asset_id,
        postId: i.post_id,
        postTitle: i.post_title,
        publishedAt: i.published_at,
        publishedDate: i.published_date,
        channelName: i.channel_name,
        eventId: i.event_id,
        eventTitle: i.event_title,
        eventStartsOn: i.event_starts_on,
        subjectAppears: i.subject_appears,
      })),
      moreImages: r.more_images,
    };
  }

  async getSong(id: string): Promise<SongDetail> {
    const res = await this.api<{
      song: { id: string; name: string; reading: string | null };
      releases: {
        id: string;
        subtype: string;
        name: string;
        position: number | null;
        is_title: boolean;
        released_on: string | null;
      }[];
      performances: {
        item_id: string;
        id: string;
        title: string;
        kind: string;
        starts_on: string | null;
        part: string | null;
        parent_id: string | null;
        parent_title: string | null;
        parent_kind: string | null;
        subject_status: ItemParticipation;
      }[];
      subject: { id: string; name: string } | null;
    }>("GET", `/songs/${encodeURIComponent(id)}`);
    return {
      ...res.song,
      releases: res.releases.map((r) => ({
        id: r.id,
        subtype: r.subtype,
        name: r.name,
        position: r.position,
        isTitle: r.is_title,
        releasedOn: r.released_on,
      })),
      subject: res.subject,
      performances: res.performances.map((p) => ({
        itemId: p.item_id,
        eventId: p.id,
        title: p.title,
        kind: p.kind,
        startsOn: p.starts_on,
        part: p.part,
        parentId: p.parent_id,
        parentTitle: p.parent_title,
        parentKind: p.parent_kind,
        subjectStatus: p.subject_status,
      })),
    };
  }

  importSongs(data: unknown): Promise<SongImportResult> {
    return this.api<SongImportResult>("POST", "/songs/import", data);
  }

  async loadIntakeMedia(intakeId: string, sha256: string): Promise<string> {
    const blob = await this.apiBlob(`/intake/${encodeURIComponent(intakeId)}/files/${sha256}`);
    return URL.createObjectURL(blob);
  }

  async decide(
    id: string,
    decision: Decision,
    options: { draft?: DraftInput; note?: string; basedOn?: string } = {},
  ): Promise<ApproveOutcome> {
    const body = {
      ...(options.note ? { note: options.note } : {}),
      ...(decision === "approve" && options.draft ? { draft: options.draft } : {}),
      ...(decision === "approve" && options.basedOn ? { based_on: options.basedOn } : {}),
    };
    const res = await this.api<ApproveResponse>(
      "POST",
      `/intake/${encodeURIComponent(id)}/${decision}`,
      body,
    );
    return approveOutcome(res);
  }

  async undoApproval(id: string): Promise<void> {
    await this.api("POST", `/intake/${encodeURIComponent(id)}/undo-approve`, {});
  }

  async redetectIntake(): Promise<{ checked: number; updated: number }> {
    return this.api<{ checked: number; updated: number }>("POST", "/intake/redetect", {});
  }

  async reopenIntake(id: string): Promise<void> {
    await this.api("POST", `/intake/${encodeURIComponent(id)}/reopen`, {});
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

  async listTagCandidates(): Promise<RefLabel[]> {
    const rows = rowsOf<{ id: string; canonical_name: string }>(
      await this.supabase
        .from("entities")
        .select("id, canonical_name")
        .eq("attributes->>tag_candidate", "true")
        .is("merged_into", null)
        .order("reading", { ascending: true, nullsFirst: false })
        .limit(500),
    );
    return rows.map((r) => ({ id: r.id, type: "entity" as const, label: r.canonical_name }));
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

  async searchPostTitles(query: string): Promise<PostTitleHit[]> {
    const q = query.trim();
    if (!q) return [];
    const rows = rowsOf<{
      post_id: string;
      title: string;
      channel_name: string;
      published_at: string | null;
      published_date: string | null;
    }>(await this.supabase.rpc("search_post_titles", { query: q, max_rows: 50 }));
    return rows.map((r) => ({
      postId: r.post_id,
      title: r.title,
      channelName: r.channel_name,
      date: r.published_at ?? r.published_date,
    }));
  }

  async listAssets(
    filter: AssetFilter,
    page: { offset: number; limit: number },
  ): Promise<{ items: AssetCard[]; hasMore: boolean }> {
    const type = filter.mediaType ?? "image";
    let ids: string[] | null = null;
    let hasMoreLinks = false;
    // シリーズ（決定記録 0064）か写っている人で絞るときは、紐付けを新しい順に区切って取り、そのアセットを読む
    const by = filter.seriesId
      ? { role: "series", to: filter.seriesId }
      : filter.personId
        ? { role: "appears", to: filter.personId }
        : null;
    if (by) {
      const links = rowsOf<{ from_id: string }>(
        await this.supabase
          .from("links")
          .select("from_id")
          .eq("from_type", "asset")
          .eq("to_type", "entity")
          .eq("to_id", by.to)
          .eq("role", by.role)
          .eq("review_state", "accepted")
          .order("created_at", { ascending: false })
          .range(page.offset, page.offset + page.limit),
      );
      hasMoreLinks = links.length > page.limit;
      ids = links.slice(0, page.limit).map((l) => l.from_id);
      // シリーズと写っている人の両方なら、区切った分のうち、その人が写っているものだけにする
      if (filter.seriesId && filter.personId && ids.length > 0) {
        const both = rowsOf<{ from_id: string }>(
          await this.supabase
            .from("links")
            .select("from_id")
            .eq("from_type", "asset")
            .eq("to_type", "entity")
            .eq("to_id", filter.personId)
            .eq("role", "appears")
            .eq("review_state", "accepted")
            .in("from_id", ids),
        );
        const keep = new Set(both.map((l) => l.from_id));
        ids = ids.filter((id) => keep.has(id));
      }
      if (ids.length === 0) return { items: [], hasMore: hasMoreLinks };
    }
    let q = this.supabase
      .from("assets")
      .select(
        "id, media_type, title, attributes, created_at, posts!inner(id, title, url, published_at, published_date, channel_id, channels(name)), asset_files(variant, provider, storage_key, byte_size)",
      )
      .neq("file_policy", "reference_only")
      .order("created_at", { ascending: false });
    if (type !== "all") q = q.eq("media_type", type);
    if (filter.channelId) q = q.eq("posts.channel_id", filter.channelId);
    q = ids ? q.in("id", ids) : q.range(page.offset, page.offset + page.limit);
    const rows = rowsOf<{
      id: string;
      media_type: string;
      title: string | null;
      attributes: Record<string, unknown> | null;
      created_at: string;
      posts: {
        id: string;
        title: string | null;
        url: string | null;
        published_at: string | null;
        published_date: string | null;
        channels: { name: string } | null;
      } | null;
      asset_files: {
        variant: string;
        provider: string;
        storage_key: string;
        byte_size: number | null;
      }[];
    }>(await q);
    const hasMore = ids ? hasMoreLinks : rows.length > page.limit;
    const items = (ids ? rows : rows.slice(0, page.limit)).map((a) => {
      const source = a.attributes?.["source_url"];
      return {
        id: a.id,
        postId: a.posts?.id ?? null,
        postTitle: a.posts?.title ?? null,
        channelName: a.posts?.channels?.name ?? "",
        publishedAt: a.posts?.published_at ?? null,
        publishedDate: a.posts?.published_date ?? null,
        mediaType: a.media_type,
        title: a.title,
        imageUrl: a.media_type === "image" && typeof source === "string" ? source : null,
        openUrl: openUrlOf(a.asset_files.find((f) => f.variant === "original")),
        pageUrl: a.posts?.url ?? null,
        byteSize: a.asset_files.find((f) => f.variant === "original")?.byte_size ?? null,
        savedAt: a.created_at,
      };
    });
    return { items, hasMore };
  }

  async listChannels(): Promise<{ id: string; name: string }[]> {
    return rowsOf<{ id: string; name: string }>(
      await this.supabase.from("channels").select("id, name").order("name"),
    );
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
          "id, post_id, position, media_type, title, description, classification, attributes, file_policy, asset_texts(text_type, content), asset_files(variant, provider, storage_key, byte_size)",
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
      // データ品質の検査（stored_without_file）と同じ条件
      missingOriginal:
        a.file_policy === "stored" &&
        a.media_type !== "text" &&
        !a.asset_files.some((f) => f.variant === "original"),
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

  /** 連載・企画（シリーズ）の一覧（決定記録 0064） */
  async listSeries(): Promise<RefLabel[]> {
    const rows = rowsOf<{ id: string; canonical_name: string }>(
      await this.supabase
        .from("entities")
        .select("id, canonical_name")
        .eq("type", "work")
        .eq("subtype", "series")
        .is("merged_into", null)
        .order("canonical_name"),
    );
    return rows.map((r) => ({ id: r.id, type: "entity" as const, label: r.canonical_name }));
  }

  async getAssetLinks(assetId: string, postId: string | null) {
    const rows = rowsOf<{
      role: string;
      from_type: string;
      to_type: RefLabel["type"];
      to_id: string;
    }>(
      await this.supabase
        .from("links")
        .select("role, from_type, to_type, to_id")
        .eq("review_state", "accepted")
        .or(
          [
            `and(from_type.eq.asset,from_id.eq.${assetId})`,
            ...(postId ? [`and(from_type.eq.post,from_id.eq.${postId})`] : []),
          ].join(","),
        ),
    );
    const labels = await this.labels(rows.map((l) => ({ id: l.to_id, type: l.to_type })));
    const all = rows.map((l, i) => ({ from: l.from_type, role: l.role, target: labels[i]! }));
    return {
      asset: all.filter((l) => l.from === "asset").map(({ role, target }) => ({ role, target })),
      post: all.filter((l) => l.from === "post").map(({ role, target }) => ({ role, target })),
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

  async setMemberRole(discordUserId: string, role: "worker" | "viewer"): Promise<void> {
    rpcRows(
      await this.supabase.rpc("set_member_role", {
        member_discord_user_id: discordUserId,
        new_role: role,
      }),
    );
  }

  async removeMember(discordUserId: string): Promise<void> {
    rpcRows(await this.supabase.rpc("remove_member", { member_discord_user_id: discordUserId }));
  }

  async listTriage(
    options: {
      mention?: TriageMentionFilter;
      sort?: TriageSort;
      source?: TriageSource;
      query?: string;
    } = {},
  ) {
    // 1 件ずつ本文と画像を見て判断するため、一度に読むのは 50 件まで（多いと開くのが遅くなる）
    const params = new URLSearchParams({ state: "triage", limit: String(TRIAGE_PAGE) });
    if (options.source && options.source !== "all") params.set("source", options.source);
    if (options.mention && options.mention !== "all") params.set("mention", options.mention);
    if (options.sort && options.sort !== "oldest") params.set("sort", options.sort);
    if (options.query?.trim()) params.set("q", options.query.trim());
    const { items, total, counts, subject_ids, query_matches } = await this.api<{
      items: (IntakeRow & { query_hits?: number })[];
      total: number;
      counts: TriageCounts;
      subject_ids: string[];
      query_matches?: number | null;
    }>("GET", `/intake?${params.toString()}`);
    const subjects = new Set(subject_ids);
    return {
      total,
      counts,
      queryMatches: query_matches ?? null,
      items: items.map((i): TriageItem =>
        triageItemOf(
          {
            id: i.id,
            channelName: i.channel_name,
            capturedAt: i.captured_at,
            draft: i.draft,
            channelKind: i.channel_kind ?? null,
            queryHits: i.query_hits ?? 0,
          },
          subjects,
        ),
      ),
    };
  }

  async keepAndApprove(id: string, draft: DraftInput): Promise<ApproveOutcome> {
    return approveOutcome(
      await this.api<ApproveResponse>("POST", `/intake/${encodeURIComponent(id)}/keep`, {
        draft,
        approve: true,
      }),
    );
  }

  async getPostEdit(postId: string): Promise<PostEdit> {
    const res = await this.api<{
      draft: DraftInput;
      based_on: string;
      channel: {
        name: string;
        kind: string | null;
        availability: string | null;
        ownerEntityId: string | null;
      };
    }>("GET", `/posts/${encodeURIComponent(postId)}/edit`);
    return {
      draft: res.draft,
      basedOn: res.based_on,
      channelName: res.channel.name,
      channelKind: res.channel.kind,
      channelAvailability: res.channel.availability,
      channelOwnerId: res.channel.ownerEntityId,
    };
  }

  async savePostEdit(postId: string, draft: DraftInput, basedOn: string): Promise<void> {
    await this.api("POST", `/posts/${encodeURIComponent(postId)}/edit`, {
      draft,
      based_on: basedOn,
    });
  }

  async retryPostFiles(postId: string): Promise<{ stored: number; missing: number }> {
    const res = await this.api<{ stored: number; missing: number }>(
      "POST",
      `/posts/${encodeURIComponent(postId)}/files/retry`,
      {},
    );
    return { stored: res.stored, missing: res.missing };
  }

  async keepTriage(id: string, draft: DraftInput): Promise<void> {
    await this.api("POST", `/intake/${encodeURIComponent(id)}/keep`, { draft });
  }

  async listDiscarded(): Promise<DiscardedItem[]> {
    const { items } = await this.api<{
      items: {
        id: string;
        channel_name: string;
        title: string | null;
        url: string | null;
        reviewed_at: string | null;
        reviewed_by_name: string | null;
      }[];
    }>("GET", "/intake/discarded");
    return items.map((i) => ({
      id: i.id,
      channelName: i.channel_name,
      title: i.title,
      url: i.url,
      discardedAt: i.reviewed_at,
      discardedByName: i.reviewed_by_name,
    }));
  }

  async restoreDiscarded(id: string): Promise<void> {
    await this.api("POST", `/intake/${encodeURIComponent(id)}/restore`, {});
  }

  discardTriage(ids: string[]) {
    return this.api<{ done: string[]; failed: { id: string; error: string }[] }>(
      "POST",
      "/intake/no-mention",
      { ids },
    );
  }

  async listEvents(
    filter: {
      query?: string;
      kind?: string;
      from?: string;
      to?: string;
      schedule?: "hide" | "include";
      regular?: "hide" | "include";
    } = {},
  ) {
    const params = new URLSearchParams({ limit: "200" });
    if (filter.schedule === "hide") params.set("schedule", "hide");
    if (filter.regular === "hide") params.set("regular", "hide");
    if (filter.query?.trim()) params.set("q", filter.query.trim());
    if (filter.kind) params.set("kind", filter.kind);
    if (filter.from) params.set("from", filter.from);
    if (filter.to) params.set("to", filter.to);
    const { items, total } = await this.api<{ items: EventRow[]; total: number }>(
      "GET",
      `/events?${params.toString()}`,
    );
    return {
      total,
      items: items.map((r): EventSummary => ({
        id: r.id,
        kind: r.kind,
        eventType: r.event_type,
        title: r.title ?? "（題名なし）",
        parentId: r.parent_id,
        parentTitle: r.parent_title ?? null,
        part: r.part ?? null,
        scheduleCount: r.schedule_count ?? 0,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
        datePrecision: r.date_precision,
        workName: r.work_name,
        episodeNumber: r.episode_number ?? null,
        hasSources: r.has_sources,
        subjectStatus: r.subject_status,
        classification: r.classification,
      })),
    };
  }

  async getEvent(id: string): Promise<EventDetail> {
    const {
      event: e,
      participants,
      children,
      usage,
      can_delete,
      materials,
      items,
    } = await this.api<EventDetailResponse>("GET", `/events/${encodeURIComponent(id)}`);
    const attributes = e.attributes ?? {};
    const sources = Array.isArray(attributes["sources"])
      ? (attributes["sources"] as { url?: unknown }[])
          .filter((x): x is { url: string } => typeof x.url === "string")
          .map((x) => ({ url: x.url }))
      : [];
    return {
      id: e.id,
      kind: e.kind,
      eventType: typeof attributes["event_type"] === "string" ? attributes["event_type"] : null,
      title: e.title ?? "",
      parentId: e.parent_id,
      parentTitle: e.parent_title,
      parentKind: e.parent_kind ?? null,
      part: typeof attributes["part"] === "string" ? attributes["part"] : null,
      workId: e.work_id,
      workName: e.work_name,
      venueId: e.venue_id,
      venueName: e.venue_name,
      episodeNumber: e.episode_number,
      startsOn: e.starts_on,
      endsOn: e.ends_on,
      datePrecision: e.date_precision,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      sources,
      classification: e.classification,
      participants: participants.map((p) => ({
        entityId: p.entity_id,
        entityName: p.entity_name,
        role: p.role,
        status: p.status,
        characterName: p.character_name,
      })),
      children: children.map((c) => ({
        id: c.id,
        kind: c.kind,
        title: c.title ?? "（題名なし）",
        startsOn: c.starts_on,
        endsOn: c.ends_on ?? null,
        startsAt: c.starts_at ?? null,
        datePrecision: c.date_precision,
        venueName: c.venue_name ?? null,
        part: c.part ?? null,
        subjectStatus: c.subject_status ?? null,
      })),
      createdAt: e.created_at,
      updatedAt: e.updated_at,
      createdByName: e.created_by_name,
      updatedByName: e.updated_by_name,
      canDelete: can_delete,
      usage,
      items: (items ?? []).map((i) => ({
        id: i.id,
        itemType: i.item_type,
        workId: i.work_id,
        workName: i.work_name,
        title: i.title,
        note: i.note,
        linked: i.linked,
      })),
      materials: materials.map((m) => ({
        postId: m.post_id,
        title: m.title,
        url: m.url,
        publishedAt: m.published_at,
        publishedDate: m.published_date,
        channelName: m.channel_name,
        channelKind: m.channel_kind,
        role: m.role,
        images: (m.images ?? []).map((i) => ({
          assetId: i.asset_id,
          fileAssetId: i.file_asset_id,
        })),
      })),
    };
  }

  async saveEvent(id: string | null, input: EventInput): Promise<string> {
    const body = {
      kind: input.kind,
      event_type: input.eventType,
      title: input.title,
      parent_id: input.parentId,
      work_id: input.workId,
      venue_id: input.venueId,
      episode_number: input.episodeNumber,
      part: input.part ?? null,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      date_precision: input.datePrecision,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      sources: input.sources,
      classification: input.classification,
      participants: input.participants.map((p) => ({
        entity_id: p.entityId,
        role: p.role,
        status: p.status,
        character_name: p.characterName,
      })),
      ...(input.items
        ? {
            items: input.items.map((i) => ({
              id: i.id,
              item_type: i.itemType,
              work_id: i.workId,
              title: i.title,
              note: i.note,
            })),
          }
        : {}),
    };
    const path = id ? `/events/${encodeURIComponent(id)}` : "/events";
    const result = await this.api<{ id: string }>("POST", path, body);
    return result.id;
  }

  /** 覚えた縮めた画像を捨てる（ログアウト・利用者が替わったとき） */
  forgetThumbnails(): void {
    this.thumbnailBlobs.clear();
  }

  async removeAsset(assetId: string): Promise<void> {
    this.thumbnailBlobs.delete(assetId);
    await this.api("POST", `/assets/${encodeURIComponent(assetId)}/remove`, {});
  }

  async deleteEvent(id: string): Promise<void> {
    await this.api("POST", `/events/${encodeURIComponent(id)}/delete`, {});
  }

  async linkEventMaterial(eventId: string, postId: string): Promise<void> {
    await this.api("POST", `/events/${encodeURIComponent(eventId)}/materials`, {
      post_id: postId,
    });
  }

  async unlinkEventMaterial(eventId: string, postId: string): Promise<void> {
    await this.api("POST", `/events/${encodeURIComponent(eventId)}/materials/remove`, {
      post_id: postId,
    });
  }

  async previewSource(url: string): Promise<SourcePreview | null> {
    const r = await this.api<
      | { found: false }
      | {
          found: true;
          state: SourcePreview["state"];
          post_id: string | null;
          intake_id: string | null;
          title: string | null;
          channel_name: string;
          published_at: string | null;
          published_date: string | null;
        }
    >("GET", `/events/source-preview?url=${encodeURIComponent(url)}`);
    if (!r.found) return null;
    return {
      state: r.state,
      postId: r.post_id,
      intakeId: r.intake_id,
      title: r.title,
      channelName: r.channel_name,
      publishedAt: r.published_at,
      publishedDate: r.published_date,
    };
  }

  async findEntities(query: string, types: readonly string[]): Promise<EntityOption[]> {
    // 読みでも探す（or の条件の書き方を壊す文字は除く）
    const q = query.replace(/[,()"\\]/g, " ").trim();
    if (!q) return [];
    const pattern = `%${q.replace(/[%_]/g, (ch) => `\\${ch}`)}%`;
    const rows = rowsOf<{
      id: string;
      type: string;
      subtype: string | null;
      canonical_name: string;
    }>(
      await this.supabase
        .from("entities")
        .select("id, type, subtype, canonical_name")
        .in("type", [...types])
        .is("merged_into", null)
        .or(`canonical_name.ilike.${pattern},reading.ilike.${pattern}`)
        .order("canonical_name")
        .limit(20),
    );
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      subtype: r.subtype,
      label: r.canonical_name,
    }));
  }

  async createEntity(entity: NewEntity) {
    const result = await this.api<{ id: string; name: string; created: boolean }>(
      "POST",
      "/entities",
      {
        type: entity.type,
        subtype: entity.subtype,
        canonical_name: entity.name,
        classification: entity.classification,
      },
    );
    return {
      id: result.id,
      type: entity.type,
      subtype: entity.subtype,
      label: result.name,
      created: result.created,
    };
  }

  async listArchiveSubjects(): Promise<RefLabel[]> {
    const rows = rowsOf<{ id: string; canonical_name: string }>(
      await this.supabase
        .from("entities")
        .select("id, canonical_name")
        .eq("type", "person")
        .is("merged_into", null)
        .contains("attributes", { archive_subject: true })
        .order("canonical_name"),
    );
    return rows.map((r) => ({ id: r.id, type: "entity" as const, label: r.canonical_name }));
  }
}

interface EventRow {
  id: string;
  kind: string;
  event_type: string | null;
  title: string | null;
  parent_id: string | null;
  parent_title?: string | null;
  part?: string | null;
  schedule_count?: number;
  starts_on: string | null;
  ends_on: string | null;
  date_precision: string | null;
  work_name: string | null;
  episode_number: number | null;
  has_sources: boolean;
  subject_status: ParticipantStatus | null;
  classification: Classification;
}

interface EventDetailResponse {
  event: {
    id: string;
    kind: string;
    title: string | null;
    parent_id: string | null;
    parent_title: string | null;
    parent_kind?: string | null;
    work_id: string | null;
    work_name: string | null;
    venue_id: string | null;
    venue_name: string | null;
    episode_number: number | null;
    starts_on: string | null;
    ends_on: string | null;
    date_precision: string | null;
    starts_at: string | null;
    ends_at: string | null;
    attributes: Record<string, unknown> | null;
    classification: Classification;
    created_at: string;
    updated_at: string;
    created_by_name: string | null;
    updated_by_name: string | null;
  };
  participants: {
    entity_id: string;
    entity_name: string;
    role: string;
    status: ParticipantStatus;
    character_name: string | null;
  }[];
  items?: {
    id: string;
    item_type: string;
    work_id: string | null;
    work_name: string | null;
    title: string | null;
    note: string | null;
    linked: boolean;
  }[];
  children: {
    id: string;
    kind: string;
    title: string | null;
    starts_on: string | null;
    ends_on?: string | null;
    starts_at?: string | null;
    date_precision: string | null;
    venue_name?: string | null;
    part?: string | null;
    subject_status?: ParticipantStatus | null;
  }[];
  usage: { links: number; drafts: number; children: number };
  can_delete: boolean;
  materials: {
    post_id: string;
    title: string | null;
    url: string | null;
    published_at: string | null;
    published_date: string | null;
    channel_name: string;
    channel_kind: string;
    role: string;
    images?: { asset_id: string; file_asset_id: string | null }[];
  }[];
}
