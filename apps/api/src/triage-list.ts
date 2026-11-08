// 振り分け待ちの一覧を、言及の強さで絞り込み・並べ替える（設計書 決定記録 0021・0024）
//
// 言及は 2 段で扱う。
// - 本人への言及: 蓄積対象の人物（entities.attributes.archive_subject の人物）への言及
// - 期への言及: 蓄積対象の期など、人物以外の蓄積対象への言及（「五期生」「同期」）
// 本人への言及のある記事を先に見られるよう、本人への言及の数 → 期への言及の数 → 古い順に並べられる。
// 数は、言及の検出の規則が下書きに残した根拠（evidence.count）から数える。登場するメンバーのタグ付けの
// 候補（evidence.purpose = tag）と、人が外した候補は数えない。
// どちらの言及も無い記事は、ほかのメンバーの名前が出るか（タグ付けの候補があるか）で分ける。ニュースでは、
// メンバーの名前の無いもの（グループ全体の告知かもしれない）を先に、ほかのメンバーの名前だけのもの
// （本人に関係ない可能性が高い）を後に並べる（設計書 決定記録 0028）。

import type { Database } from "@aletheia/db/client";
import { sql } from "kysely";
import { z } from "zod";

export const triageListQuery = z.object({
  /**
   * all すべて / any 言及あり / subject 本人への言及あり / group_only 期への言及だけ / none 言及なし /
   * unnamed 言及なしのうちメンバーの名前も無い / others_only 言及なしのうちほかのメンバーの名前だけ
   */
  mention: z
    .enum(["all", "any", "subject", "group_only", "none", "unnamed", "others_only"])
    .default("all"),
  /** 情報源の種類: all すべて / blog メンバーのブログ / news 公式サイトのニュースなど（web） */
  source: z.enum(["all", "blog", "news"]).default("all"),
  /** oldest 記事の古い順 / newest 記事の新しい順 / signal 言及の強い順 */
  sort: z.enum(["oldest", "newest", "signal"]).default("oldest"),
  /** 言葉で探す（空白で区切ると複数）。題名か本文に含むものを先に並べ、その後は sort の順 */
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(200),
});
export type TriageListQuery = z.output<typeof triageListQuery>;

/** 蓄積対象の人物の ID（文字列） */
const subjectPersons = sql`(
  select e.id::text from public.entities e
  where e.type = 'person' and e.merged_into is null and e.attributes @> '{"archive_subject": true}'
)`;

/** 下書きの言及の数（本人へ、または本人以外の蓄積対象へ） */
function mentionCount(toSubjectPerson: boolean) {
  return sql<number>`coalesce((
    select sum(case when (l -> 'evidence' ->> 'count') ~ '^[0-9]+$'
                    then (l -> 'evidence' ->> 'count')::int else 1 end)
    from jsonb_array_elements(case when jsonb_typeof(i.draft -> 'links') = 'array'
                                   then i.draft -> 'links' else '[]'::jsonb end) l
    where l ->> 'role' = 'mentioned'
      and l ->> 'from' = 'post'
      and coalesce(l -> 'evidence' ->> 'purpose', '') <> 'tag'
      and coalesce(l ->> 'accepted', 'true') <> 'false'
      and (l ->> 'to_id') ${toSubjectPerson ? sql`in` : sql`not in`} ${subjectPersons}
  ), 0)::int`;
}

/** 登場するメンバーのタグ付けの候補（ほかのメンバーの名前）の数 */
const tagCount = sql<number>`coalesce((
  select count(*)
  from jsonb_array_elements(case when jsonb_typeof(i.draft -> 'links') = 'array'
                                 then i.draft -> 'links' else '[]'::jsonb end) l
  where l ->> 'role' = 'mentioned'
    and l ->> 'from' = 'post'
    and l -> 'evidence' ->> 'purpose' = 'tag'
    and coalesce(l ->> 'accepted', 'true') <> 'false'
), 0)::int`;

/** 振り分けの画面の種類と、情報源の種類（channels.kind）の対応 */
export const SOURCE_KINDS = { blog: "blog", news: "web" } as const;

/** 言及の強さ（並べ替え・絞り込み・件数に使う） */
interface Signal {
  id: string;
  /** 探す言葉のうち、題名か本文に含むものの数 */
  hits: number;
  /** 記事の日時（公開日時。無ければ公開日の JST 0 時、それも無ければ取り込んだ日時） */
  dated_at: number;
  s: number;
  g: number;
  t: number;
}

function matches(mention: TriageListQuery["mention"], x: Signal): boolean {
  switch (mention) {
    case "any":
      return x.s > 0 || x.g > 0;
    case "subject":
      return x.s > 0;
    case "group_only":
      return x.s === 0 && x.g > 0;
    case "none":
      return x.s === 0 && x.g === 0;
    case "unnamed":
      return x.s === 0 && x.g === 0 && x.t === 0;
    case "others_only":
      return x.s === 0 && x.g === 0 && x.t > 0;
    default:
      return true;
  }
}

/** 記事の古い順（同じ日時は id の順） */
function byOldest(a: Signal, b: Signal): number {
  return a.dated_at - b.dated_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** 記事の新しい順（同じ日時は id の逆順） */
function byNewest(a: Signal, b: Signal): number {
  return -byOldest(a, b);
}

/** 記事の日時。下書きの公開日時 → 公開日（JST の 0 時）→ 取り込んだ日時の順に使う */
function datedAt(
  publishedAt: string | null,
  publishedDate: string | null,
  capturedAt: Date | string,
): number {
  const at = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  if (!Number.isNaN(at)) return at;
  const day = publishedDate ? Date.parse(`${publishedDate}T00:00:00+09:00`) : Number.NaN;
  if (!Number.isNaN(day)) return day;
  return new Date(capturedAt).getTime();
}

/** 言及の強い順: 本人への言及、期への言及の多い順。言及の無いものは、ほかのメンバーの名前の無いものを先に */
function bySignal(a: Signal, b: Signal): number {
  return b.s - a.s || b.g - a.g || Number(a.t > 0) - Number(b.t > 0) || byOldest(a, b);
}

const SORTS = { oldest: byOldest, newest: byNewest, signal: bySignal } as const;

/**
 * 振り分け待ちの一覧。下書きの中身（本文を含む）は大きく、件数も多いため、言及の強さは 1 回だけ
 * 数え（下書きの紐付けから）、絞り込み・並べ替え・件数はその結果で行い、中身は画面に出す分だけ読む
 */
/** 探す言葉（空白で区切る。5 語まで） */
export function queryWords(q: string | undefined): string[] {
  return [...new Set((q ?? "").split(/\s+/).filter(Boolean))].slice(0, 5);
}

/** 下書きの題名と本文のうち、探す言葉を含むものの数（大文字・小文字は区別しない） */
function wordHits(words: string[]) {
  return sql<number>`(
    select count(*)::int
    from (
      select lower(
        coalesce(i.draft -> 'post' ->> 'title', '') || ' ' || coalesce((
          select string_agg(t ->> 'content', ' ')
          from jsonb_array_elements(case when jsonb_typeof(i.draft -> 'assets') = 'array'
                                         then i.draft -> 'assets' else '[]'::jsonb end) a,
               jsonb_array_elements(case when jsonb_typeof(a -> 'texts') = 'array'
                                         then a -> 'texts' else '[]'::jsonb end) t
        ), '')
      ) as doc
    ) d, unnest(${words}::text[]) as w(word)
    where strpos(d.doc, lower(w.word)) > 0
  )`;
}

export async function listTriage(db: Database, q: TriageListQuery) {
  const words = queryWords(q.q);
  const signals: Signal[] = (
    await db
      .selectFrom("intake_items as i")
      .innerJoin("channels as ch", "ch.id", "i.channel_id")
      .select([
        "i.id",
        "i.captured_at",
        sql<string | null>`i.draft -> 'post' ->> 'published_at'`.as("published_at"),
        sql<string | null>`i.draft -> 'post' ->> 'published_date'`.as("published_date"),
        mentionCount(true).as("s"),
        mentionCount(false).as("g"),
        tagCount.as("t"),
        words.length > 0 ? wordHits(words).as("hits") : sql<number>`0`.as("hits"),
      ])
      .where("i.state", "=", "triage")
      .$if(q.source !== "all", (qb) =>
        qb.where("ch.kind", "=", SOURCE_KINDS[q.source as "blog" | "news"]),
      )
      .execute()
  ).map((r) => ({
    id: r.id,
    dated_at: datedAt(r.published_at, r.published_date, r.captured_at),
    hits: Number(r.hits),
    s: Number(r.s),
    g: Number(r.g),
    t: Number(r.t),
  }));

  const counts = {
    all: signals.length,
    any: 0,
    subject: 0,
    group_only: 0,
    none: 0,
    unnamed: 0,
    others_only: 0,
  };
  for (const key of ["any", "subject", "group_only", "none", "unnamed", "others_only"] as const) {
    counts[key] = signals.filter((x) => matches(key, x)).length;
  }

  // 言葉を含むもの（多く含むもの）を先に、その後は選んだ並び
  const order = SORTS[q.sort];
  const shown = signals.filter((x) => matches(q.mention, x));
  const queryMatches = shown.filter((x) => x.hits > 0).length;
  const picked = shown.sort((a, b) => b.hits - a.hits || order(a, b)).slice(0, q.limit);
  const signalOf = new Map(picked.map((x) => [x.id, x]));
  const rows =
    picked.length === 0
      ? []
      : await db
          .selectFrom("intake_items as i")
          .innerJoin("channels as ch", "ch.id", "i.channel_id")
          .select([
            "i.id",
            "ch.key as channel_key",
            "ch.name as channel_name",
            "i.external_id",
            "i.route",
            "i.route_ref",
            "i.captured_at",
            "i.state",
            "i.draft",
            "i.reviewed_at",
            "i.review_note",
            "ch.kind as channel_kind",
          ])
          .where(
            "i.id",
            "in",
            picked.map((x) => x.id),
          )
          .execute();
  const rowOf = new Map(rows.map((r) => [r.id, r]));
  // 数えた後に別の画面で処理されたものは出さない
  const items = picked.flatMap((x) => {
    const row = rowOf.get(x.id);
    if (!row || row.state !== "triage") return [];
    const signal = signalOf.get(x.id)!;
    return [
      {
        ...row,
        subject_mentions: signal.s,
        group_mentions: signal.g,
        tag_mentions: signal.t,
        query_hits: signal.hits,
      },
    ];
  });

  // 画面で、言及ごとに本人へのものか期へのものかを見分けるため
  const subjects = await db
    .selectFrom("entities")
    .select("id")
    .where("type", "=", "person")
    .where("merged_into", "is", null)
    .where(sql<boolean>`attributes @> '{"archive_subject": true}'`)
    .execute();
  return {
    items,
    total: counts[q.mention],
    counts,
    // 探す言葉を含むものの数（いま選んでいる絞り込みの中で）
    query_matches: words.length > 0 ? queryMatches : null,
    subject_ids: subjects.map((r) => r.id),
  };
}
