// 振り分け・承認の画面の「出来事」: この投稿を、どの仕事・公式の発表の話として紐付けるか
//
// 候補は、題名の文字の重なりと日付の近さで関連の高い順に並べる（設計書 決定記録 0033）。上位を
// 「関連が高そうな出来事」として先に出し、選ぶ欄は押すとプルダウンで開き、打つと絞り込める。
// 合う出来事が無ければ、題名・種類・日付だけでその場で作れる（詳細は出来事の画面で入れる）。
// ニュースの振り分けと承認の画面で使う（決定記録 0033・0051）。
// レギュラーの作品を選べば、その作品の回・号として作る（決定記録 0071）。
// その場で作るときは、本人の出演と、番組の回・掲載なら作品も付ける。出演の初めの値は規則で決める（決定記録 0080）。

import type { DraftInput } from "@aletheia/intake/draft";
import { titleStem } from "@aletheia/intake/titles";
import { CalendarPlus, ExternalLink, Plus, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import { useApp } from "../context.tsx";
import {
  ENTITY_SUBTYPE_LABELS,
  EVENT_KIND_LABELS,
  EVENT_KIND_SHORT,
  eventDateLabel,
  PARTICIPANT_ROLE_LABELS,
} from "../format.ts";
import {
  matchesEventQuery,
  normalizeForMatch,
  rankEvents,
  SUGGEST_MIN,
} from "../source/event-relevance.ts";
import {
  episodeKindOf,
  parseEpisodeNumber,
  regularEpisodeInput,
  regularTitleOf,
} from "../source/regular.ts";
import { defaultSubjectRole, subjectStatusDefault } from "../source/participation.ts";
import { eventsOf, isEventContent, setEventLink } from "../source/tags.ts";
import type {
  Classification,
  EventSummary,
  ParticipantStatus,
  RefLabel,
  WorkSummary,
} from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { ClassificationChoice, useSearch } from "./EntityPicker.tsx";

/** 候補を探す、日付の前後の日数 */
const AROUND_DAYS = 45;
/** 作品の「新しく作る」 */
const NEW_WORK = "__new__";
/** 楽曲の画面で扱う作品の種類（その場で作る作品に出さない。決定記録 0066） */
const MUSIC_SUBTYPES = new Set(["song", "single", "album", "music_video"]);
/** 「関連が高そうな出来事」として先に出す数 */
const SUGGEST = 3;
/** プルダウンに出す数 */
const LIST = 30;

const jstDate = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);

/** 投稿の日付（JST の暦日） */
function postDate(draft: DraftInput): string | null {
  const at = draft.post.published_at;
  if (at) {
    const d = new Date(at);
    if (!Number.isNaN(d.getTime())) return jstDate(d);
  }
  return draft.post.published_date ?? null;
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return jstDate(d);
}

/** 関連の高さを比べる、投稿の文（題名・本文・キャプション） */
function postText(draft: DraftInput): string {
  const texts = (draft.assets ?? [])
    .flatMap((a) => a.texts ?? [])
    .filter((t) => t.text_type === "body" || t.text_type === "caption")
    .map((t) => t.content);
  return [draft.post.title ?? "", ...texts].join("\n");
}

function eventMeta(e: EventSummary): string {
  // 日程は、まとまりの題名を添える（設計書 決定記録 0034）
  const of = e.parentTitle && e.kind !== "episode" ? `「${e.parentTitle}」の日程・` : "";
  const no = e.episodeNumber !== null ? `#${e.episodeNumber}・` : "";
  return `${of}${no}${EVENT_KIND_SHORT[e.kind] ?? e.kind}・${eventDateLabel(e.startsOn, e.endsOn, e.datePrecision)}${e.part ? ` ${e.part}` : ""}`;
}

function EventChip({ event, onAdd }: { event: EventSummary; onAdd: () => void }) {
  return (
    <button type="button" className="event-candidate" onClick={onAdd}>
      <Plus size={12} aria-hidden="true" />
      <span className="event-candidate-title">{event.title}</span>
      <span className="quiet">{eventMeta(event)}</span>
    </button>
  );
}

export function EventLinks({
  draft,
  onChange,
  name,
  onLabel,
  readOnly,
  dates = [],
  required = false,
  allowCreate = false,
  title = "出来事",
  subject = "この投稿",
}: {
  draft: DraftInput;
  onChange: (d: DraftInput) => void;
  name: (id: string) => string;
  onLabel: (ref: RefLabel) => void;
  readOnly: boolean;
  /** 候補を探す日付（ニュースの本文に出てくる日付など）。投稿日も足す */
  dates?: string[];
  /** 紐付けが要るとき（ニュース）は「（任意）」を出さない */
  required?: boolean;
  /** その場で作れるか（作業者・運営者。決定記録 0033・0051） */
  allowCreate?: boolean;
  title?: string;
  /** その場で作るときの案内で、紐付ける相手の呼び方 */
  subject?: string;
}) {
  const { source } = useApp();
  const id = useId();
  const posted = postDate(draft);
  const days = useMemo(
    () => [...new Set([...dates, ...(posted ? [posted] : [])])].sort(),
    [dates, posted],
  );
  const from = days.length > 0 ? shift(days[0]!, -AROUND_DAYS) : null;
  const to = days.length > 0 ? shift(days[days.length - 1]!, AROUND_DAYS) : null;
  const text = useMemo(() => postText(draft), [draft]);
  const linked = eventsOf(draft);
  // 本人（蓄積対象の人物）。その場で作るときの出演の初めの値に使う（決定記録 0080）
  const [subjects] = useLoad(() => source.listArchiveSubjects(), [source], [], "archive-subjects");
  const [groups] = useLoad(
    () => source.listArchiveSubjectGroups?.() ?? Promise.resolve([]),
    [source],
    [],
    "archive-subject-groups",
  );
  const subjectList = useMemo(() => (subjects.status === "ready" ? subjects.data : []), [subjects]);
  const participation = useMemo(
    () =>
      subjectStatusDefault(
        draft,
        new Set(subjectList.map((s) => s.id)),
        new Set(groups.status === "ready" ? groups.data.map((g) => g.id) : []),
      ),
    [draft, subjectList, groups],
  );
  // 出来事の画面を別に開いて作って戻ってきたとき・その場で作ったとき、候補を読み直す
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setVersion((v) => v + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  const [around] = useLoad(
    () => (from && to ? source.listEvents({ from, to }) : Promise.resolve({ items: [], total: 0 })),
    [source, from, to, version],
  );
  const [query, setQuery] = useState("");
  const found = useSearch<EventSummary>(
    query,
    async (q) => (await source.listEvents({ query: q })).items,
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);

  const add = (e: { id: string; title: string }) => {
    onLabel({ id: e.id, type: "event", label: e.title });
    onChange(setEventLink(draft, e.id, true));
    setQuery("");
    setOpen(false);
  };

  const context = { text, dates: days };
  const pool = around.status === "ready" ? around.data.items : [];
  const ranked = rankEvents(
    pool.filter((e) => !linked.includes(e.id)),
    context,
  );
  const suggestions = ranked.filter((r) => r.score >= SUGGEST_MIN).slice(0, SUGGEST);

  // プルダウン: 何も打っていなければ関連の高い順、打てばその言葉を含むもの（日付の近い候補と、探した結果）
  const q = normalizeForMatch(query);
  const options = (() => {
    if (!q) return ranked.slice(0, LIST).map((r) => r.event);
    const local = pool.filter((e) => matchesEventQuery(e, query));
    const merged = new Map<string, EventSummary>();
    for (const e of [...local, ...(found ?? [])]) if (!linked.includes(e.id)) merged.set(e.id, e);
    return rankEvents([...merged.values()], context)
      .slice(0, LIST)
      .map((r) => r.event);
  })();
  const canCreate = allowCreate && query.trim() !== "";
  const count = options.length + (canCreate ? 1 : 0);
  const pick = (index: number) => {
    if (index < options.length) add(options[index]!);
    else if (canCreate) {
      setCreating(query.trim());
      setOpen(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (count === 0 ? 0 : (a + 1) % count));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (count === 0 ? 0 : (a - 1 + count) % count));
    } else if (e.key === "Enter" && open && count > 0) {
      e.preventDefault();
      pick(Math.min(active, count - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <section className="event-links" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="record-heading">
        {title}
        {!required && <span className="quiet">（任意）</span>}
      </h3>
      {linked.length > 0 && (
        <div className="record-people" role="group" aria-label="紐付けた出来事">
          {linked.map((e) => {
            const content = isEventContent(draft, e);
            return (
              <span key={e} className="event-linked">
                <button
                  type="button"
                  className="person-chip is-on"
                  disabled={readOnly}
                  aria-label={`${name(e)} の紐付けを外す`}
                  onClick={() => onChange(setEventLink(draft, e, false))}
                >
                  {name(e)}
                  <X size={12} aria-hidden="true" />
                </button>
                {/* その回の映像・誌面そのものなら「本体」（決定記録 0083） */}
                <label className="event-content-toggle">
                  <input
                    type="checkbox"
                    checked={content}
                    disabled={readOnly}
                    onChange={(ev) => onChange(setEventLink(draft, e, true, ev.target.checked))}
                  />
                  この投稿が「{name(e)}」の本体（映像・誌面など）
                </label>
              </span>
            );
          })}
        </div>
      )}
      {created && (
        <p className="quiet event-created">
          「{created.title}」を作って紐付けました。出演・作品などの詳細は{" "}
          <a href={`#/events/${created.id}`} target="_blank" rel="noopener">
            出来事の画面で入れる
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        </p>
      )}

      {!readOnly && creating === null && (
        <>
          {suggestions.length > 0 && (
            <div className="event-candidates" role="group" aria-label="関連が高そうな出来事">
              <span className="field-hint">関連が高そうな出来事</span>
              {suggestions.map(({ event }) => (
                <EventChip key={event.id} event={event} onAdd={() => add(event)} />
              ))}
            </div>
          )}
          <div className="event-combo">
            <label className="visually-hidden" htmlFor={`${id}-q`}>
              出来事を選ぶ・題名で探す
            </label>
            <input
              id={`${id}-q`}
              type="search"
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                open && count > 0 ? optionId(Math.min(active, count - 1)) : undefined
              }
              placeholder="押すと候補が開きます。題名・作品名・回の番号（#368）で探せます"
              value={query}
              autoComplete="off"
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onKeyDown={onKey}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                setOpen(true);
              }}
            />
            {open && (
              <ul
                id={listId}
                role="listbox"
                className="picker-results event-combo-list"
                aria-label="出来事の候補"
                // 押したときに入力欄から外れて閉じないようにする
                onMouseDown={(e) => e.preventDefault()}
              >
                {around.status === "loading" && !q && (
                  <li className="quiet picker-none">読み込んでいます</li>
                )}
                {count === 0 && around.status !== "loading" && (
                  <li className="quiet picker-none">
                    {q
                      ? "見つかりませんでした"
                      : "日付の近い出来事はありません。題名で探してください"}
                  </li>
                )}
                {options.map((e, i) => (
                  <li
                    key={e.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    className={`picker-option ${i === active ? "is-active" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => add(e)}
                  >
                    <span>{e.title}</span>
                    <span className="quiet">{eventMeta(e)}</span>
                  </li>
                ))}
                {canCreate && (
                  <li
                    id={optionId(options.length)}
                    role="option"
                    aria-selected={active === options.length}
                    className={`picker-option is-create ${active === options.length ? "is-active" : ""}`}
                    onMouseEnter={() => setActive(options.length)}
                    onClick={() => pick(options.length)}
                  >
                    <Plus size={12} aria-hidden="true" />「{query.trim()}」で新しく作る
                  </li>
                )}
              </ul>
            )}
          </div>
          {allowCreate ? (
            <button
              type="button"
              className="link-button event-create-open"
              onClick={() => setCreating(query.trim())}
            >
              <CalendarPlus size={12} aria-hidden="true" /> 合う出来事が無ければ、ここで作る
            </button>
          ) : (
            <p className="field-hint event-create-hint">
              合う出来事が無いときは、
              <a href="#/events/new" target="_blank" rel="noopener" className="event-create-open">
                <CalendarPlus size={12} aria-hidden="true" /> 出来事の画面で作って
              </a>
              から選んでください。
            </p>
          )}
        </>
      )}
      {!readOnly && creating !== null && (
        <QuickEvent
          initialTitle={creating}
          subject={subject}
          dates={days}
          person={subjectList[0] ?? null}
          participation={participation}
          onCancel={() => setCreating(null)}
          onCreated={(e) => {
            setCreating(null);
            setCreated(e);
            setVersion((v) => v + 1);
            add(e);
          }}
        />
      )}
    </section>
  );
}

/**
 * その場で作る（題名・種類・日付だけ。設計書 決定記録 0033）。詳細は出来事の画面で入れる。
 * 出来事は仕事と公式の発表だけなので、すべて公開（決定記録 0029）
 */
function QuickEvent({
  initialTitle,
  subject,
  dates,
  person,
  participation,
  onCancel,
  onCreated,
}: {
  initialTitle: string;
  subject: string;
  dates: readonly string[];
  /** 本人（蓄積対象の人物）。いなければ出演の欄を出さない */
  person: RefLabel | null;
  /** 本人の出演の初めの値と、その理由（決定記録 0080） */
  participation: { status: ParticipantStatus | null; reason: string | null };
  onCancel: () => void;
  onCreated: (e: { id: string; title: string }) => void;
}) {
  const { source } = useApp();
  const id = useId();
  const [kind, setKind] = useState("episode");
  const [title, setTitle] = useState(initialTitle);
  const [startsOn, setStartsOn] = useState("");
  const [workId, setWorkId] = useState("");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 本人の出演（"" は付けない。選ぶまでは規則の初めの値）。役割は種類が変わったら初めの値に戻す
  const [chosen, setStatus] = useState<ParticipantStatus | "" | null>(null);
  const status = chosen ?? participation.status ?? "";
  const [role, setRole] = useState<string | null>(null);
  const subjectRole = role ?? defaultSubjectRole(kind);
  // 作品。レギュラーの作品を選ぶと、その作品の回・号として作る（決定記録 0071）。それ以外の番組・雑誌は、
  // 回・掲載を作るときに付け先として選べ、無ければ名前と種類だけで作れる（決定記録 0080）
  const [works] = useLoad(
    async () => (source.listWorks ? await source.listWorks({}) : ([] as WorkSummary[])),
    [source],
  );
  const allWorks = works.status === "ready" ? works.data : [];
  const regularWorks = allWorks.filter((w) => w.regular);
  const [ofWork, setOfWork] = useState("");
  const [newWorkName, setNewWorkName] = useState("");
  const [newWorkSubtype, setNewWorkSubtype] = useState("");
  // 作る作品の公開区分は、既定を置かずに選んでもらう
  const [newWorkClassification, setNewWorkClassification] = useState<Classification | null>(null);
  const episodeLike = kind === "episode" || kind === "publication";
  const fittingWorks = allWorks.filter((w) => !w.regular && episodeKindOf(w.subtype) === kind);
  const work = regularWorks.find((w) => w.id === workId) ?? null;
  const episodeNumber = parseEpisodeNumber(number);

  const createEpisode = (w: WorkSummary) => {
    if (episodeNumber === undefined) return setError("回の番号は 0 以上の整数で入れてください");
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const subjects = await source.listArchiveSubjects();
        const input = regularEpisodeInput({
          work: w,
          title,
          startsOn: startsOn || null,
          episodeNumber,
          subjects,
        });
        const eventId = await source.saveEvent(null, input);
        onCreated({ id: eventId, title: input.title });
      } catch (e) {
        setBusy(false);
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  const create = () => {
    if (work) return createEpisode(work);
    if (!title.trim()) return setError("題名を入れてください");
    const of = episodeLike ? ofWork : "";
    if (of === NEW_WORK && (!newWorkName.trim() || !newWorkSubtype || !newWorkClassification)) {
      return setError("作品の名前・種類・公開区分を入れてください");
    }
    setBusy(true);
    setError(null);
    void (async () => {
      const workId =
        of === NEW_WORK && newWorkClassification
          ? (
              await source.createEntity({
                type: "work",
                subtype: newWorkSubtype,
                name: newWorkName.trim(),
                classification: newWorkClassification,
              })
            ).id
          : of && of !== NEW_WORK
            ? of
            : null;
      return source.saveEvent(null, {
        kind,
        eventType: null,
        title: title.trim(),
        parentId: null,
        workId,
        venueId: null,
        // 作品に付けるときは、題名の号・回の印から番号を読む（決定記録 0080）
        episodeNumber: workId ? titleStem(title).number : null,
        startsOn: startsOn || null,
        endsOn: null,
        datePrecision: startsOn ? "day" : null,
        startsAt: null,
        endsAt: null,
        sources: [],
        classification: "public",
        participants:
          person && status
            ? [{ entityId: person.id, role: subjectRole, status, characterName: null }]
            : [],
      });
    })()
      .then((eventId) => onCreated({ id: eventId, title: title.trim() }))
      .catch((e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  return (
    <div className="picker-create" role="group" aria-label="出来事をその場で作る">
      <p className="picker-create-title">出来事をその場で作る</p>
      {regularWorks.length > 0 && (
        <div className="field">
          <label htmlFor={`${id}-work`}>レギュラーの作品（選ぶと、その回・号として作る）</label>
          <select
            id={`${id}-work`}
            value={workId}
            onChange={(e) => {
              setWorkId(e.target.value);
              // 題名は省ける（作品名と回の番号になる）
              if (e.target.value && title === initialTitle) setTitle("");
            }}
          >
            <option value="">選ばない</option>
            {regularWorks.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-title`}>{work ? "題名（任意）" : "題名"}</label>
        <input
          id={`${id}-title`}
          value={title}
          autoFocus
          placeholder={work ? regularTitleOf(work.name, episodeNumber ?? null) : undefined}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field-row">
        {work ? (
          <div className="field">
            <label htmlFor={`${id}-number`}>回の番号（任意）</label>
            <input
              id={`${id}-number`}
              inputMode="numeric"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </div>
        ) : (
          <div className="field">
            <label htmlFor={`${id}-kind`}>種類</label>
            <select
              id={`${id}-kind`}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setRole(null);
              }}
            >
              {Object.entries(EVENT_KIND_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor={`${id}-date`}>日付（任意）</label>
          <input
            id={`${id}-date`}
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </div>
      </div>
      {dates.length > 0 && (
        <div className="quick-dates" role="group" aria-label="本文の日付・投稿日">
          <span className="field-hint">本文の日付・投稿日:</span>
          {dates.map((d) => (
            <button
              key={d}
              type="button"
              className={`person-chip ${d === startsOn ? "is-on" : ""}`}
              aria-pressed={d === startsOn}
              onClick={() => setStartsOn(d)}
            >
              {d.slice(5).replace("-", "/")}
            </button>
          ))}
        </div>
      )}
      {!work && episodeLike && (
        <div className="field-row quick-work">
          <div className="field">
            <label htmlFor={`${id}-of`}>
              {kind === "publication" ? "雑誌・連載（任意）" : "番組（任意）"}
            </label>
            <select
              id={`${id}-of`}
              value={ofWork}
              onChange={(e) => {
                setOfWork(e.target.value);
                if (e.target.value === NEW_WORK) {
                  if (!newWorkName) setNewWorkName(titleStem(title).stem);
                  if (!newWorkSubtype && kind === "publication") setNewWorkSubtype("magazine");
                }
              }}
            >
              <option value="">付けない</option>
              {fittingWorks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
              <option value={NEW_WORK}>新しく作る</option>
            </select>
          </div>
          {ofWork === NEW_WORK && (
            <>
              <div className="field">
                <label htmlFor={`${id}-of-name`}>作品の名前</label>
                <input
                  id={`${id}-of-name`}
                  value={newWorkName}
                  onChange={(e) => setNewWorkName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor={`${id}-of-subtype`}>作品の種類</label>
                <select
                  id={`${id}-of-subtype`}
                  value={newWorkSubtype}
                  onChange={(e) => setNewWorkSubtype(e.target.value)}
                >
                  <option value="">選んでください</option>
                  {Object.entries(ENTITY_SUBTYPE_LABELS["work"] ?? {})
                    .filter(([k]) => episodeKindOf(k) === kind && !MUSIC_SUBTYPES.has(k))
                    .map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                </select>
              </div>
              <ClassificationChoice
                name={`${id}-of-classification`}
                value={newWorkClassification}
                onChange={setNewWorkClassification}
              />
            </>
          )}
        </div>
      )}
      {!work && person && (
        <div className="field-row quick-participation">
          <div className="field">
            <label htmlFor={`${id}-status`}>{person.label}の出演</label>
            <select
              id={`${id}-status`}
              value={status}
              onChange={(e) => setStatus(e.target.value as ParticipantStatus | "")}
            >
              <option value="">付けない</option>
              <option value="scheduled">予定</option>
              <option value="appeared">出演した</option>
              <option value="not_appearing">出ていない</option>
            </select>
          </div>
          {status && (
            <div className="field">
              <label htmlFor={`${id}-role`}>役割</label>
              <select
                id={`${id}-role`}
                value={subjectRole}
                onChange={(e) => setRole(e.target.value)}
              >
                {Object.entries(PARTICIPANT_ROLE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
      {!work && person && participation.reason && (
        <p
          className={`field-hint ${participation.status === "not_appearing" ? "quick-absence" : ""}`}
        >
          {participation.reason}
        </p>
      )}
      <p className="field-hint">
        {work
          ? `「${work.name}」の${EVENT_KIND_LABELS[episodeKindOf(work.subtype)] ?? "回"}として作り、蓄積対象の人物の出演を付けて${subject}に紐付けます。`
          : `公開の出来事として作り、${subject}に紐付けます。${episodeLike ? "番組・雑誌に付けると、作品の画面に回・号として並びます。" : ""}会場などの詳細は、出来事の画面で入れてください。`}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="picker-create-actions">
        <button type="button" className="button" disabled={busy} onClick={onCancel}>
          やめる
        </button>
        <button type="button" className="button primary" disabled={busy} onClick={create}>
          作って紐付ける
        </button>
      </div>
    </div>
  );
}
