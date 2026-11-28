// 人物の一覧と人物の画面（設計書 決定記録 0079）
//
// 第一の柱（本人の発言と、メンバーからの言及）を読めるようにする。
// - 一覧（/people）: 蓄積対象の人物を先に、メンバーを期ごとに。発言・言及などの件数
// - 人物の画面（/people/:id）: 発言・言及・出演・プロフィールの 4 つ（?tab= で開く区画、?speaker= で言及した人）
// - メンバーの画面からは、蓄積対象の人物への言及を、そのメンバーで絞って開ける

import { Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { BackLink } from "../components/BackLink.tsx";
import { useApp } from "../context.tsx";
import {
  CHANNEL_KIND_LABELS,
  channelKindLabel,
  EVENT_KIND_SHORT,
  eventDateLabel,
  formatPublished,
  PARTICIPANT_ROLE_LABELS,
  PARTICIPANT_STATUS_LABELS,
  RELATION_LABELS,
  SPEAKER_TYPE_LABELS,
  STATEMENT_PROPERTY_LABELS,
} from "../format.ts";
import type {
  PersonEvent,
  PersonMention,
  PersonPost,
  PersonSummary,
  PersonView,
} from "../source/types.ts";
import { useLoad } from "../use-load.ts";

const nf = new Intl.NumberFormat("ja-JP");
const PAGE = 30;

type Tab = "posts" | "mentions" | "events" | "profile";
const TABS: { key: Tab; label: string }[] = [
  { key: "posts", label: "発言" },
  { key: "mentions", label: "言及" },
  { key: "events", label: "出演" },
  { key: "profile", label: "プロフィール" },
];

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 「一期生」「5期生」などの数（期の並べ替え）。数が無ければ後ろ */
function generationNumber(name: string): number {
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const m = /([0-9０-９]+|[一二三四五六七八九十]+)\s*期/.exec(name);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const raw = m[1]!.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === "十") return 10;
  return [...raw].reduce((n, ch) => (ch === "十" ? (n || 1) * 10 : n + (digits[ch] ?? 0)), 0);
}

/** 投稿の日付の表示 */
function dateOf(x: { date: string | null; precision: string | null }): string {
  if (!x.date) return "日付なし";
  return (
    formatPublished(
      x.precision
        ? { publishedDate: x.date, publishedDatePrecision: x.precision }
        : { publishedAt: x.date },
    ) ?? x.date
  );
}

/** 言及した人の種類の呼び名 */
function speakerKindLabel(type: string | null): string {
  if (type === "person") return "メンバー";
  if (type === null) return "発信者不明";
  return "公式・媒体";
}

// ---------------------------------------------------------------------------
// 一覧
// ---------------------------------------------------------------------------

function PersonCounts({ p, subjectName }: { p: PersonSummary; subjectName: string | null }) {
  const parts = [
    `発言 ${nf.format(p.counts.posts)}`,
    `言及された ${nf.format(p.counts.mentioned)}`,
    ...(!p.archiveSubject && subjectName && p.counts.mentionsSubject > 0
      ? [`${subjectName}への言及 ${nf.format(p.counts.mentionsSubject)}`]
      : []),
    `写っている ${nf.format(p.counts.appears)}`,
    `出演 ${nf.format(p.counts.events)}`,
  ];
  return <span className="person-counts">{parts.join(" ・ ")}</span>;
}

function PeopleList() {
  const { source } = useApp();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [typed, setTyped] = useState(q);
  const [list] = useLoad(() => source.listPeople(q), [source, q], [], `people:${q}`);

  const sections = useMemo(() => {
    if (list.status !== "ready") return null;
    const people = list.data;
    const subjects = people.filter((p) => p.archiveSubject);
    const rest = people.filter((p) => !p.archiveSubject);
    // 期（generation）ごと。期の無い人は所属のグループ、どちらも無ければ「そのほか」
    const groups = new Map<string, { name: string; order: number; people: PersonSummary[] }>();
    for (const p of rest) {
      const generation = p.groups.find((g) => g.subtype === "generation");
      const group = generation ?? p.groups[0];
      const key = group?.id ?? "";
      const entry = groups.get(key) ?? {
        name: group?.name ?? "そのほか",
        order: group ? generationNumber(group.name) : Number.MAX_SAFE_INTEGER + 1,
        people: [],
      };
      entry.people.push(p);
      groups.set(key, entry);
    }
    // 蓄積対象の人物と同じ期を先に
    const subjectGroups = new Set(subjects.flatMap((s) => s.groups.map((g) => g.id)));
    const ordered = [...groups.entries()]
      .sort(([ka, a], [kb, b]) => {
        const sa = subjectGroups.has(ka) ? 0 : 1;
        const sb = subjectGroups.has(kb) ? 0 : 1;
        return sa - sb || a.order - b.order || a.name.localeCompare(b.name, "ja");
      })
      .map(([, v]) => v);
    return { subjects, groups: ordered };
  }, [list]);
  const subjectName = sections?.subjects[0]?.name ?? null;

  return (
    <section className="page">
      <div className="page-head">
        <h1 className="page-title">人物</h1>
        <p className="page-sub">
          本人の発言と、メンバーからの言及・出演・プロフィールを、人物ごとに読めます。
        </p>
      </div>
      <form
        className="triage-search people-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const next = typed.trim();
          setParams(next ? { q: next } : {});
        }}
      >
        <label htmlFor="people-q" className="visually-hidden">
          人物の名前で探す
        </label>
        <Search size={16} aria-hidden="true" />
        <input
          id="people-q"
          type="search"
          value={typed}
          placeholder="名前・読み・愛称で探す"
          onChange={(e) => setTyped(e.target.value)}
        />
      </form>
      {list.status === "loading" && <p className="quiet">読み込んでいます</p>}
      {list.status === "error" && (
        <p className="error" role="alert">
          読み込めませんでした: {list.error.message}
        </p>
      )}
      {sections && sections.subjects.length === 0 && sections.groups.length === 0 && (
        <p className="quiet">当てはまる人物はいません。</p>
      )}
      {sections && sections.subjects.length > 0 && (
        <div className="person-subjects">
          {sections.subjects.map((p) => (
            <Link key={p.id} to={`/people/${p.id}`} className="person-subject-card">
              <span className="person-subject-name">{p.name}</span>
              {p.reading && <span className="quiet">{p.reading}</span>}
              <PersonCounts p={p} subjectName={null} />
            </Link>
          ))}
        </div>
      )}
      {sections?.groups.map((g) => (
        <section key={g.name} className="person-group" aria-label={g.name}>
          <h2 className="column-title">
            {g.name} <span className="work-count">{g.people.length} 人</span>
          </h2>
          <ul className="person-list">
            {g.people.map((p) => (
              <li key={p.id}>
                <Link to={`/people/${p.id}`} className="person-name">
                  {p.name}
                </Link>
                <PersonCounts p={p} subjectName={subjectName} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 人物の画面
// ---------------------------------------------------------------------------

/** 一覧を「もっと見る」で継ぎ足す。条件（key）が変わったら最初から */
function usePaged<T>(
  key: string,
  fetch: (page: { offset: number; limit: number }) => Promise<{ items: T[]; hasMore: boolean }>,
) {
  const [first] = useLoad(() => fetch({ offset: 0, limit: PAGE }), [key]);
  const [extra, setExtra] = useState<{ key: string; items: T[]; hasMore: boolean }>({
    key: "",
    items: [],
    hasMore: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const more = extra.key === key ? extra : { key, items: [] as T[], hasMore: false };
  const items = first.status === "ready" ? [...first.data.items, ...more.items] : [];
  const hasMore =
    first.status === "ready" && (more.items.length > 0 ? more.hasMore : first.data.hasMore);
  const loadMore = () => {
    setBusy(true);
    setError(null);
    fetch({ offset: items.length, limit: PAGE })
      .then((r) => setExtra({ key, items: [...more.items, ...r.items], hasMore: r.hasMore }))
      .catch((e: unknown) => setError(message(e)))
      .finally(() => setBusy(false));
  };
  return { first, items, hasMore, loadMore, busy, error };
}

function MoreButton({
  paged,
}: {
  paged: { hasMore: boolean; loadMore: () => void; busy: boolean; error: string | null };
}) {
  return (
    <>
      {paged.error && (
        <p className="error" role="alert">
          {paged.error}
        </p>
      )}
      {paged.hasMore && (
        <button
          type="button"
          className="button block"
          disabled={paged.busy}
          onClick={paged.loadMore}
        >
          {paged.busy ? "読み込んでいます" : "もっと見る"}
        </button>
      )}
    </>
  );
}

function PersonPosts({ view }: { view: PersonView }) {
  const { source } = useApp();
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") ?? "";
  const id = view.person.id;
  const paged = usePaged<PersonPost>(`${id}:${kind}`, (page) =>
    source.listPersonPosts(id, kind ? { kind } : {}, page),
  );
  const setKind = (next: string) => {
    const p = new URLSearchParams(params);
    if (next) p.set("kind", next);
    else p.delete("kind");
    setParams(p, { replace: true });
  };
  return (
    <div className="person-section">
      {view.postKinds.length > 1 && (
        <div className="tabs person-filter" role="tablist" aria-label="情報源の種類">
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={kind === ""}
            onClick={() => setKind("")}
          >
            すべて（{nf.format(view.counts.posts)}）
          </button>
          {view.postKinds.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="tab"
              className="tab"
              aria-selected={kind === k.kind}
              onClick={() => setKind(k.kind)}
            >
              {CHANNEL_KIND_LABELS[k.kind] ?? k.kind}（{nf.format(k.count)}）
            </button>
          ))}
        </div>
      )}
      {paged.first.status === "loading" && <p className="quiet">読み込んでいます</p>}
      {paged.first.status === "error" && (
        <p className="error" role="alert">
          読み込めませんでした: {paged.first.error.message}
        </p>
      )}
      {paged.first.status === "ready" && paged.items.length === 0 && (
        <p className="quiet">
          {view.person.name}{" "}
          が発信した投稿は、まだ承認されていません（ブログ・トークなどを承認すると、ここに並びます）。
        </p>
      )}
      {paged.items.length > 0 && (
        <ol className="person-feed" aria-label="発言">
          {paged.items.map((p) => (
            <li key={p.postId} className="person-feed-item">
              <div className="person-feed-meta">
                <span>{dateOf(p)}</span>
                <span className="tag">{channelKindLabel(p.channelKind)}</span>
                <span className="quiet">{p.channelName}</span>
                {p.images > 0 && <span className="quiet">画像 {p.images}</span>}
              </div>
              <Link to={`/posts/${p.postId}`} className="person-feed-title">
                {p.title ?? "（題名なし）"}
              </Link>
              {p.head && <p className="person-feed-text">{p.head}</p>}
            </li>
          ))}
        </ol>
      )}
      <MoreButton paged={paged} />
    </div>
  );
}

function Snippets({ mention }: { mention: PersonMention }) {
  return (
    <>
      {mention.snippets.map((s, i) => (
        <p key={i} className="person-feed-text">
          {s.before}
          {s.match && <mark>{s.match}</mark>}
          {s.after}
        </p>
      ))}
    </>
  );
}

function PersonMentions({ view }: { view: PersonView }) {
  const { source } = useApp();
  const [params, setParams] = useSearchParams();
  const speaker = params.get("speaker") ?? "";
  const id = view.person.id;
  const paged = usePaged<PersonMention>(`${id}:${speaker}`, (page) =>
    source.listPersonMentions(id, speaker ? { speaker } : {}, page),
  );
  const setSpeaker = (next: string) => {
    const p = new URLSearchParams(params);
    if (next) p.set("speaker", next);
    else p.delete("speaker");
    setParams(p, { replace: true });
  };
  const groups = useMemo(() => {
    const order = ["メンバー", "公式・媒体", "発信者不明"];
    const map = new Map<string, PersonView["speakers"]>();
    for (const s of view.speakers) {
      const label = speakerKindLabel(s.type);
      map.set(label, [...(map.get(label) ?? []), s]);
    }
    return order.filter((k) => map.has(k)).map((k) => ({ label: k, speakers: map.get(k)! }));
  }, [view.speakers]);
  const chosen = view.speakers.find((s) => (s.id ?? "none") === speaker);

  return (
    <div className="person-section">
      {view.speakers.length > 0 && (
        <div className="person-speakers" aria-label="言及した人">
          {groups.map((g) => (
            <div key={g.label} className="person-speaker-group">
              <span className="person-speaker-kind">{g.label}</span>
              {g.speakers.map((s) => {
                const key = s.id ?? "none";
                const active = key === speaker;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`chip ${active ? "is-active" : ""}`}
                    aria-pressed={active}
                    onClick={() => setSpeaker(active ? "" : key)}
                  >
                    {s.name ?? "発信者不明"}{" "}
                    <span className="chip-count">{nf.format(s.count)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {chosen && (
        <p className="person-filter-note">
          {chosen.name ?? "発信者不明"} の投稿だけを出しています。
          <button type="button" className="link-button" onClick={() => setSpeaker("")}>
            すべての言及に戻す
          </button>
          {chosen.id && chosen.type === "person" && (
            <Link to={`/people/${chosen.id}`} className="person-filter-link">
              {chosen.name} の画面
            </Link>
          )}
        </p>
      )}
      {paged.first.status === "loading" && <p className="quiet">読み込んでいます</p>}
      {paged.first.status === "error" && (
        <p className="error" role="alert">
          読み込めませんでした: {paged.first.error.message}
        </p>
      )}
      {paged.first.status === "ready" && paged.items.length === 0 && (
        <p className="quiet">
          {view.person.name}{" "}
          に触れた投稿は、まだ承認されていません（メンバーのブログ・トーク、ニュースなどを承認すると、ここに並びます）。
        </p>
      )}
      {paged.items.length > 0 && (
        <ol className="person-feed" aria-label="言及">
          {paged.items.map((m) => (
            <li key={m.postId} className="person-feed-item">
              <div className="person-feed-meta">
                {m.speaker ? (
                  m.speaker.type === "person" ? (
                    <Link to={`/people/${m.speaker.id}`} className="person-feed-speaker">
                      {m.speaker.name}
                    </Link>
                  ) : (
                    <span className="person-feed-speaker">{m.speaker.name}</span>
                  )
                ) : (
                  <span className="person-feed-speaker quiet">発信者不明</span>
                )}
                <span>{dateOf(m)}</span>
                <span className="tag">{channelKindLabel(m.channelKind)}</span>
                {m.marked && <span className="tag mention-marked-tag">関係あり</span>}
              </div>
              <Snippets mention={m} />
              <Link to={`/posts/${m.postId}`} className="person-feed-source">
                {m.title ?? "（題名なし）"}（{m.channelName}）
              </Link>
            </li>
          ))}
        </ol>
      )}
      <MoreButton paged={paged} />
    </div>
  );
}

/** 出演の 1 行の日付 */
function eventDate(e: PersonEvent): string {
  return e.startsOn ? eventDateLabel(e.startsOn, e.endsOn, e.datePrecision) : "日付なし";
}

function statusTag(status: string) {
  return (
    <span className={`event-status status-${status}`}>
      {PARTICIPANT_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function PersonEvents({ view }: { view: PersonView }) {
  const { source } = useApp();
  const id = view.person.id;
  const [list] = useLoad(() => source.listPersonEvents(id), [source, id]);
  const data = useMemo(() => {
    if (list.status !== "ready") return null;
    const rows = list.data;
    // レギュラーの作品の回は作品ごとにまとめる（決定記録 0071）
    const regular = new Map<
      string,
      { id: string; name: string; counts: Record<string, number>; first: string; last: string }
    >();
    const others: PersonEvent[] = [];
    for (const e of rows) {
      if (e.work?.regular) {
        const entry = regular.get(e.work.id) ?? {
          id: e.work.id,
          name: e.work.name,
          counts: {},
          first: e.startsOn ?? "",
          last: e.startsOn ?? "",
        };
        entry.counts[e.status] = (entry.counts[e.status] ?? 0) + 1;
        if (e.startsOn && (!entry.first || e.startsOn < entry.first)) entry.first = e.startsOn;
        if (e.startsOn && e.startsOn > entry.last) entry.last = e.startsOn;
        regular.set(e.work.id, entry);
      } else {
        others.push(e);
      }
    }
    // 日程（まとまりの各日）は、まとまりが一覧にあればそこにまとめる
    const ids = new Set(others.map((e) => e.id));
    const children = new Map<string, number>();
    for (const e of others) {
      if (e.parentId && ids.has(e.parentId)) {
        children.set(e.parentId, (children.get(e.parentId) ?? 0) + 1);
      }
    }
    const top = others
      .filter((e) => !(e.parentId && ids.has(e.parentId)))
      .sort((a, b) => (b.startsOn ?? "").localeCompare(a.startsOn ?? ""));
    const years = new Map<string, PersonEvent[]>();
    for (const e of top) {
      const year = e.startsOn?.slice(0, 4) ?? "日付なし";
      years.set(year, [...(years.get(year) ?? []), e]);
    }
    return { regular: [...regular.values()], years: [...years.entries()], children };
  }, [list]);

  if (list.status === "loading") return <p className="quiet">読み込んでいます</p>;
  if (list.status === "error") {
    return (
      <p className="error" role="alert">
        読み込めませんでした: {list.error.message}
      </p>
    );
  }
  if (!data || (data.regular.length === 0 && data.years.length === 0)) {
    return (
      <p className="quiet">
        出演の記録はまだありません（出来事の画面で出演を付けると、ここに並びます）。
      </p>
    );
  }
  return (
    <div className="person-section">
      {data.regular.length > 0 && (
        <section aria-label="レギュラーの作品">
          <h3 className="column-title">レギュラーの作品</h3>
          <table className="works-table person-regular">
            <thead>
              <tr>
                <th scope="col">作品</th>
                <th scope="col" className="dashboard-num">
                  出演した
                </th>
                <th scope="col" className="dashboard-num">
                  出ていない
                </th>
                <th scope="col">期間</th>
              </tr>
            </thead>
            <tbody>
              {data.regular.map((w) => (
                <tr key={w.id}>
                  <th scope="row">
                    <Link to={`/works/${w.id}`}>{w.name}</Link>
                  </th>
                  <td className="dashboard-num">{nf.format(w.counts["appeared"] ?? 0)}</td>
                  <td className="dashboard-num">{nf.format(w.counts["not_appearing"] ?? 0)}</td>
                  <td className="quiet">
                    {w.first ? eventDateLabel(w.first, null, "day") : "—"} 〜{" "}
                    {w.last ? eventDateLabel(w.last, null, "day") : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {data.years.map(([year, events]) => (
        <section key={year} aria-label={year === "日付なし" ? year : `${year} 年`}>
          <h3 className="column-title">
            {year === "日付なし" ? year : `${year} 年`}{" "}
            <span className="work-count">{events.length} 件</span>
          </h3>
          <ul className="person-events">
            {events.map((e) => (
              <li key={`${e.id}:${e.role}`}>
                <span className="person-event-date">{eventDate(e)}</span>
                <span className="tag">{EVENT_KIND_SHORT[e.kind] ?? e.kind}</span>
                <Link to={`/events/${e.id}`} className="person-event-title">
                  {e.title ?? "（題名なし）"}
                </Link>
                {data.children.get(e.id) && (
                  <span className="quiet">日程 {data.children.get(e.id)}</span>
                )}
                <span className="quiet">
                  {PARTICIPANT_ROLE_LABELS[e.role] ?? e.role}
                  {e.characterName ? `（${e.characterName}）` : ""}
                </span>
                {statusTag(e.status)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function relationLabel(r: PersonView["relations"][number]): string {
  const label = RELATION_LABELS[r.relation];
  return label ? label[r.direction] : r.relation;
}

function period(from: string | null, to: string | null): string | null {
  if (!from && !to) return null;
  return `${from ?? ""}〜${to ?? ""}`;
}

function PersonProfile({ view }: { view: PersonView }) {
  const byProperty = useMemo(() => {
    const map = new Map<string, PersonView["statements"]>();
    for (const s of view.statements) map.set(s.property, [...(map.get(s.property) ?? []), s]);
    return [...map.entries()];
  }, [view.statements]);
  return (
    <div className="person-section">
      <section aria-label="所属・関係">
        <h3 className="column-title">所属・関係</h3>
        {view.relations.length === 0 ? (
          <p className="quiet">記録はまだありません。</p>
        ) : (
          <dl className="facts person-facts">
            {view.relations.map((r) => (
              <div key={r.id}>
                <dt>{relationLabel(r)}</dt>
                <dd>
                  {r.other.type === "person" ? (
                    <Link to={`/people/${r.other.id}`}>{r.other.name}</Link>
                  ) : r.other.type === "work" ? (
                    <Link to={`/works/${r.other.id}`}>{r.other.name}</Link>
                  ) : (
                    r.other.name
                  )}
                  {period(r.validFrom, r.validTo) && (
                    <span className="quiet">（{period(r.validFrom, r.validTo)}）</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section aria-label="言明">
        <h3 className="column-title">言明</h3>
        {byProperty.length === 0 ? (
          <p className="quiet">
            言明（好きなもの・特技など、出典つきの事柄）はまだありません。承認の画面で言明を付けると、ここに並びます。
          </p>
        ) : (
          <dl className="facts person-facts">
            {byProperty.map(([property, rows]) => (
              <div key={property}>
                <dt>{STATEMENT_PROPERTY_LABELS[property] ?? property}</dt>
                <dd>
                  <ul className="person-statements">
                    {rows.map((s) => (
                      <li key={s.id}>
                        <span>{s.value}</span>
                        <span className="quiet">
                          {[
                            s.statedOn,
                            s.speaker?.name ?? SPEAKER_TYPE_LABELS[s.speakerType] ?? null,
                          ]
                            .filter(Boolean)
                            .join(" ・ ")}
                        </span>
                        {s.post && (
                          <Link to={`/posts/${s.post.id}`} className="person-feed-source">
                            {s.post.title ?? "出典の投稿"}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      {view.person.aliases.length > 0 && (
        <section aria-label="別名・愛称">
          <h3 className="column-title">別名・愛称</h3>
          <p className="person-aliases">{view.person.aliases.join("、")}</p>
        </section>
      )}
    </div>
  );
}

function PersonPage({ id }: { id: string }) {
  const { source } = useApp();
  const [params, setParams] = useSearchParams();
  const [view] = useLoad(() => source.getPerson(id), [source, id], [], `person:${id}`);
  const tab: Tab = TABS.find((t) => t.key === params.get("tab"))?.key ?? "posts";
  const setTab = (next: Tab) => {
    const p = new URLSearchParams();
    if (next !== "posts") p.set("tab", next);
    setParams(p, { replace: true });
  };

  if (view.status === "loading") return <p className="page quiet">読み込んでいます</p>;
  if (view.status === "error") {
    return (
      <p className="page error" role="alert">
        人物を読めませんでした: {view.error.message}
      </p>
    );
  }
  const v = view.data;
  const groups = v.relations.filter((r) => r.relation === "member_of" && r.direction === "out");
  const ev = v.counts.events;
  const counts: Record<Tab, string> = {
    posts: nf.format(v.counts.posts),
    mentions: nf.format(v.counts.mentioned),
    events: nf.format(ev.appeared + ev.scheduled + ev.notAppearing + ev.cancelled),
    profile: nf.format(v.statements.length),
  };
  return (
    <article className="page wide person">
      <header className="page-head">
        <BackLink to="/people" list>
          人物の一覧
        </BackLink>
        <h1 className="page-title">
          {v.person.name}
          {v.person.reading && <span className="person-reading">{v.person.reading}</span>}
        </h1>
        <p className="badges">
          {v.person.archiveSubject && <span className="tag work-regular-tag">蓄積対象</span>}
          {groups.map((g) => (
            <span key={g.id} className="badge">
              {g.other.name}
            </span>
          ))}
          <span className="page-sub">
            写っている素材 {nf.format(v.counts.appears)}
            {v.counts.appears > 0 && (
              <>
                {" "}
                <Link to={`/assets?person=${v.person.id}`}>アセットで見る</Link>
              </>
            )}
          </span>
        </p>
        {v.subject && v.mentionsOfSubject !== null && v.mentionsOfSubject > 0 && (
          <p className="person-to-subject">
            <Users size={16} aria-hidden="true" />
            {v.person.name} が {v.subject.name} に触れた投稿 {nf.format(v.mentionsOfSubject)} 件
            <Link to={`/people/${v.subject.id}?tab=mentions&speaker=${v.person.id}`}>読む</Link>
          </p>
        )}
      </header>
      <div className="tabs person-tabs" role="tablist" aria-label="区画">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label} <span className="chip-count">{counts[t.key]}</span>
          </button>
        ))}
      </div>
      {tab === "posts" && <PersonPosts view={v} />}
      {tab === "mentions" && <PersonMentions view={v} />}
      {tab === "events" && <PersonEvents view={v} />}
      {tab === "profile" && <PersonProfile view={v} />}
    </article>
  );
}

export function PeoplePage() {
  const { id } = useParams();
  return id ? <PersonPage key={id} id={id} /> : <PeopleList />;
}
