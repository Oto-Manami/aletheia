// 振り分け・承認の画面の「出来事」: この投稿を、どの仕事・公式の発表の話として紐付けるか
//
// 投稿日（ニュースは本文に出てくる日付も）の前後の出来事を候補に並べ、押せば紐付く（about）。無ければ
// 題名で探す。出来事はここでは作らず、出来事の画面で人が選んで作る（設計書 決定記録 0030）。

import type { DraftInput } from "@aletheia/intake/draft";
import { CalendarPlus, Plus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useApp } from "../context.tsx";
import { EVENT_KIND_SHORT, eventDateLabel } from "../format.ts";
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
  readOnly,
  dates = [],
  required = false,
  title = "出来事",
}: {
  draft: DraftInput;
  onChange: (d: DraftInput) => void;
  name: (id: string) => string;
  onLabel: (ref: RefLabel) => void;
  readOnly: boolean;
  /** 候補を探す日付（ニュースの本文に出てくる日付など）。無ければ投稿日 */
  dates?: string[];
  /** 紐付けが要るとき（ニュース）は「（任意）」を出さない */
  required?: boolean;
  title?: string;
}) {
  const { source } = useApp();
  const id = useId();
  const posted = postDate(draft);
  const days = [...dates, ...(posted ? [posted] : [])].sort();
  const from = days.length > 0 ? shift(days[0]!, -AROUND_DAYS) : null;
  const to = days.length > 0 ? shift(days[days.length - 1]!, AROUND_DAYS) : null;
  const linked = eventsOf(draft);
  // 出来事の画面を別に開いて作って戻ってきたとき、候補を読み直す
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
        {!required && <span className="quiet">（任意）</span>}
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
            <div className="event-candidates" role="group" aria-label="日付の近い出来事">
              <span className="field-hint">
                {dates.length > 0 ? "本文の日付・投稿日" : "投稿日"}の前後 {AROUND_DAYS} 日の出来事
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
            placeholder="出来事を題名で探す"
            value={query}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
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
          <p className="field-hint event-create-hint">
            合う出来事が無いときは、
            <a href="#/events/new" target="_blank" rel="noopener" className="event-create-open">
              <CalendarPlus size={12} aria-hidden="true" /> 出来事の画面で作って
            </a>
            から選んでください。
          </p>
        </>
      )}
    </section>
  );
}
