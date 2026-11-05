// 承認の画面の「出来事」: この投稿を、どの仕事・公式の発表の話として紐付けるか（任意）
//
// 投稿日の前後の出来事を候補に並べ、押せば紐付く（about）。無ければ題名で探し、それでも無ければ
// その場で作る（種類・題名・日付・公開区分だけ。細かいところは出来事の画面で直す。設計書 決定記録 0027）。

import type { DraftInput } from "@aletheia/intake/draft";
import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { useApp } from "../context.tsx";
import { EVENT_KIND_LABELS, EVENT_KIND_SHORT, eventDateLabel } from "../format.ts";
import { eventsOf, setEventLink } from "../source/tags.ts";
import type { EventSummary, RefLabel } from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { useSearch } from "./EntityPicker.tsx";

/** 候補に出す、投稿日の前後の日数 */
const AROUND_DAYS = 7;

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

function EventChip({ event, onAdd }: { event: EventSummary; onAdd: () => void }) {
  return (
    <button type="button" className="event-candidate" onClick={onAdd}>
      <Plus size={12} aria-hidden="true" />
      <span className="event-candidate-title">{event.title}</span>
      <span className="quiet">
        {EVENT_KIND_SHORT[event.kind] ?? event.kind}・
        {eventDateLabel(event.startsOn, event.endsOn, event.datePrecision)}
      </span>
    </button>
  );
}

export function EventLinks({
  draft,
  onChange,
  name,
  onLabel,
  subject,
  readOnly,
  prefill,
  title = "出来事",
}: {
  draft: DraftInput;
  onChange: (d: DraftInput) => void;
  name: (id: string) => string;
  onLabel: (ref: RefLabel) => void;
  /** その場で作るとき、出演の行を置く人（蓄積対象の人物） */
  subject: RefLabel | null;
  readOnly: boolean;
  /** その場で作るときの初めの値（ニュースから作るとき。設計書 決定記録 0029） */
  prefill?: QuickPrefill;
  title?: string;
}) {
  const { source } = useApp();
  const id = useId();
  // 候補は、作る出来事の日付（ニュースの本文の日付）があればその前後、無ければ投稿日の前後
  const date = prefill?.date ?? postDate(draft);
  const linked = eventsOf(draft);
  const [version, setVersion] = useState(0);
  const [around] = useLoad(
    () =>
      date
        ? source.listEvents({ from: shift(date, -AROUND_DAYS), to: shift(date, AROUND_DAYS) })
        : Promise.resolve({ items: [], total: 0 }),
    [source, date, version],
  );
  const [query, setQuery] = useState("");
  const found = useSearch<EventSummary>(
    query,
    async (q) => (await source.listEvents({ query: q })).items,
  );
  const [creating, setCreating] = useState(prefill !== undefined);

  const add = (e: { id: string; title: string }) => {
    onLabel({ id: e.id, type: "event", label: e.title });
    onChange(setEventLink(draft, e.id, true));
    setQuery("");
  };
  const candidates =
    around.status === "ready" ? around.data.items.filter((e) => !linked.includes(e.id)) : [];
  const results = (found ?? []).filter((e) => !linked.includes(e.id));

  return (
    <section className="event-links" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="record-heading">
        {title}
        {!prefill && <span className="quiet">（任意）</span>}
      </h3>
      {linked.length > 0 && (
        <div className="record-people" role="group" aria-label="紐付けた出来事">
          {linked.map((e) => (
            <button
              key={e}
              type="button"
              className="person-chip is-on"
              disabled={readOnly}
              aria-label={`${name(e)} の紐付けを外す`}
              onClick={() => onChange(setEventLink(draft, e, false))}
            >
              {name(e)}
              <X size={12} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {!readOnly && (
        <>
          {candidates.length > 0 && (
            <div className="event-candidates" role="group" aria-label="投稿日の前後の出来事">
              <span className="field-hint">
                {prefill?.date ? "この日付" : "投稿日"}の前後 {AROUND_DAYS} 日の出来事
              </span>
              {candidates.slice(0, 8).map((e) => (
                <EventChip key={e.id} event={e} onAdd={() => add(e)} />
              ))}
            </div>
          )}
          <label className="visually-hidden" htmlFor={`${id}-q`}>
            出来事を題名で探す
          </label>
          <input
            id={`${id}-q`}
            type="search"
            placeholder="題名で探す"
            value={query}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
              setCreating(false);
            }}
          />
          {query.trim() && found && (
            <ul className="picker-results" aria-label="出来事の候補">
              {results.length === 0 && <li className="quiet picker-none">見つかりませんでした</li>}
              {results.slice(0, 10).map((e) => (
                <li key={e.id}>
                  <button type="button" className="picker-option" onClick={() => add(e)}>
                    <span>{e.title}</span>
                    <span className="quiet">
                      {eventDateLabel(e.startsOn, e.endsOn, e.datePrecision)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {creating ? (
            <QuickEvent
              key={version}
              prefill={
                prefill ?? { kind: "episode", title: query.trim(), date, time: null, dates: [] }
              }
              subject={subject}
              onCancel={() => setCreating(false)}
              onCreated={(e) => {
                setCreating(false);
                setVersion((v) => v + 1);
                add(e);
              }}
            />
          ) : (
            <button
              type="button"
              className="link-button event-create-open"
              onClick={() => setCreating(true)}
            >
              <Plus size={12} aria-hidden="true" />{" "}
              {prefill && linked.length > 0 ? "もう 1 つ作る" : "出来事をその場で作る"}
            </button>
          )}
        </>
      )}
    </section>
  );
}

export interface QuickPrefill {
  kind: string;
  title: string;
  date: string | null;
  time: string | null;
  /** 選べる日付の候補（ニュースの本文に出てくる日付） */
  dates: string[];
  /** 出典の URL */
  sources?: string[];
  /** 出演の行を最初から付けるか（既定は付ける） */
  withSubject?: boolean;
}

/**
 * その場で作る（種類・題名・日付・時刻だけ）。出来事は仕事と公式の発表だけなので、すべて公開
 * （設計書 決定記録 0029）
 */
function QuickEvent({
  prefill,
  subject,
  onCancel,
  onCreated,
}: {
  prefill: QuickPrefill;
  subject: RefLabel | null;
  onCancel: () => void;
  onCreated: (e: { id: string; title: string }) => void;
}) {
  const { source } = useApp();
  const id = useId();
  const [kind, setKind] = useState(prefill.kind);
  const [title, setTitle] = useState(prefill.title);
  const [startsOn, setStartsOn] = useState(prefill.date ?? "");
  const [time, setTime] = useState(prefill.time ?? "");
  const [withSubject, setWithSubject] = useState(prefill.withSubject ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = jstDate(new Date());
  const sources = prefill.sources ?? [];

  const create = () => {
    if (!title.trim()) return setError("題名を入れてください");
    setBusy(true);
    setError(null);
    const role = kind === "announcement" ? "announced" : "performer";
    source
      .saveEvent(null, {
        kind,
        eventType: null,
        title: title.trim(),
        parentId: null,
        workId: null,
        venueId: null,
        episodeNumber: null,
        startsOn: startsOn || null,
        endsOn: null,
        datePrecision: startsOn ? "day" : null,
        startsAt: startsOn && time ? `${startsOn}T${time}:00+09:00` : null,
        endsAt: null,
        sources: sources.map((url) => ({ url })),
        classification: "public",
        participants:
          subject && withSubject
            ? [
                {
                  entityId: subject.id,
                  role,
                  status: startsOn && startsOn < today ? "appeared" : "scheduled",
                  characterName: null,
                },
              ]
            : [],
      })
      .then((eventId) => onCreated({ id: eventId, title: title.trim() }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="picker-create" role="group" aria-label="出来事をその場で作る">
      <p className="picker-create-title">出来事をその場で作る</p>
      <div className="field">
        <label htmlFor={`${id}-kind`}>種類</label>
        <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(EVENT_KIND_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-title`}>題名</label>
        <input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${id}-date`}>日付</label>
          <input
            id={`${id}-date`}
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-time`}>時刻（任意）</label>
          <input
            id={`${id}-time`}
            type="time"
            value={time}
            disabled={!startsOn}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
      </div>
      {prefill.dates.length > 1 && (
        <div className="quick-dates" role="group" aria-label="本文に出てくる日付">
          <span className="field-hint">本文に出てくる日付:</span>
          {prefill.dates.map((d) => (
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
      {subject && (
        <label className="quick-subject">
          <input
            type="checkbox"
            checked={withSubject}
            onChange={(e) => setWithSubject(e.target.checked)}
          />
          {subject.label} の出演を付ける
        </label>
      )}
      <p className="field-hint">
        公開の出来事として作ります{sources.length > 0 ? "。このニュースを出典にします" : ""}。
        作品・会場などは、あとで出来事の画面で直せます。
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="picker-create-actions">
        <button type="button" className="button" onClick={onCancel}>
          やめる
        </button>
        <button type="button" className="button primary" disabled={busy} onClick={create}>
          作って紐付ける
        </button>
      </div>
    </div>
  );
}
