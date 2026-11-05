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
  /** oldest 取り込んだ古い順 / signal 言及の強い順 */
  sort: z.enum(["oldest", "signal"]).default("oldest"),
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

const SOURCE_KINDS = { blog: "blog", news: "web" } as const;

export async function listTriage(db: Database, q: TriageListQuery) {
  const base = db
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
      mentionCount(true).as("subject_mentions"),
      mentionCount(false).as("group_mentions"),
      tagCount.as("tag_mentions"),
      "ch.kind as channel_kind",
    ])
    .where("i.state", "=", "triage")
    .$if(q.source !== "all", (qb) =>
      qb.where("ch.kind", "=", SOURCE_KINDS[q.source as "blog" | "news"]),
    );

  // 絞り込みと並べ替えは、数えた列を使うため外側の問い合わせで行う
  let query = db.selectFrom(base.as("t")).selectAll("t");
  if (q.mention === "any") {
    query = query.where((eb) =>
      eb.or([eb("t.subject_mentions", ">", 0), eb("t.group_mentions", ">", 0)]),
    );
  } else if (q.mention === "subject") {
    query = query.where("t.subject_mentions", ">", 0);
  } else if (q.mention === "group_only") {
    query = query.where("t.subject_mentions", "=", 0).where("t.group_mentions", ">", 0);
  } else if (q.mention === "none") {
    query = query.where("t.subject_mentions", "=", 0).where("t.group_mentions", "=", 0);
  } else if (q.mention === "unnamed") {
    query = query
      .where("t.subject_mentions", "=", 0)
      .where("t.group_mentions", "=", 0)
      .where("t.tag_mentions", "=", 0);
  } else if (q.mention === "others_only") {
    query = query
      .where("t.subject_mentions", "=", 0)
      .where("t.group_mentions", "=", 0)
      .where("t.tag_mentions", ">", 0);
  }
  if (q.sort === "signal") {
    query = query
      .orderBy("t.subject_mentions", "desc")
      .orderBy("t.group_mentions", "desc")
      .orderBy(sql`t.tag_mentions > 0`, "asc");
  }
  const items = await query
    .orderBy("t.captured_at", "asc")
    .orderBy("t.id")
    .limit(q.limit)
    .execute();

  const counted = await db
    .selectFrom(
      db
        .selectFrom("intake_items as i")
        .innerJoin("channels as ch", "ch.id", "i.channel_id")
        .select([mentionCount(true).as("s"), mentionCount(false).as("g"), tagCount.as("t")])
        .where("i.state", "=", "triage")
        .$if(q.source !== "all", (qb) =>
          qb.where("ch.kind", "=", SOURCE_KINDS[q.source as "blog" | "news"]),
        )
        .as("c"),
    )
    .select([
      sql<string>`count(*)`.as("all"),
      sql<string>`count(*) filter (where s > 0 or g > 0)`.as("any"),
      sql<string>`count(*) filter (where s > 0)`.as("subject"),
      sql<string>`count(*) filter (where s = 0 and g > 0)`.as("group_only"),
      sql<string>`count(*) filter (where s = 0 and g = 0)`.as("none"),
      sql<string>`count(*) filter (where s = 0 and g = 0 and t = 0)`.as("unnamed"),
      sql<string>`count(*) filter (where s = 0 and g = 0 and t > 0)`.as("others_only"),
    ])
    .executeTakeFirstOrThrow();
  const counts = {
    all: Number(counted.all),
    any: Number(counted.any),
    subject: Number(counted.subject),
    group_only: Number(counted.group_only),
    none: Number(counted.none),
    unnamed: Number(counted.unnamed),
    others_only: Number(counted.others_only),
  };
  // 画面で、言及ごとに本人へのものか期へのものかを見分けるため
  const subjects = await db
    .selectFrom("entities")
    .select("id")
    .where("type", "=", "person")
    .where("merged_into", "is", null)
    .where(sql<boolean>`attributes @> '{"archive_subject": true}'`)
    .execute();
  return { items, total: counts[q.mention], counts, subject_ids: subjects.map((r) => r.id) };
}
