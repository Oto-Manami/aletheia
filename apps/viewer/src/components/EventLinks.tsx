// 振り分け・承認の画面の「出来事」: この投稿を、どの仕事・公式の発表の話として紐付けるか
//
// 候補は、題名の文字の重なりと日付の近さで関連の高い順に並べる（設計書 決定記録 0033）。上位を
// 「関連が高そうな出来事」として先に出し、選ぶ欄は押すとプルダウンで開き、打つと絞り込める。
// ニュースの振り分けでは、合う出来事が無ければ題名・種類・日付だけでその場で作れる（詳細は出来事の
// 画面で入れる）。承認の画面では作らない（決定記録 0030）。

import type { DraftInput } from "@aletheia/intake/draft";
import { CalendarPlus, ExternalLink, Plus, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import { useApp } from "../context.tsx";
import { EVENT_KIND_LABELS, EVENT_KIND_SHORT, eventDateLabel } from "../format.ts";
import { normalizeForMatch, rankEvents, SUGGEST_MIN } from "../source/event-relevance.ts";
import { eventsOf, setEventLink } from "../source/tags.ts";
import type { EventSummary, RefLabel } from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { useSearch } from "./EntityPicker.tsx";

/** 候補を探す、日付の前後の日数 */
const AROUND_DAYS = 45;
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
  return `${EVENT_KIND_SHORT[e.kind] ?? e.kind}・${eventDateLabel(e.startsOn, e.endsOn, e.datePrecision)}`;
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
  allowCreate = false,
  title = "出来事",
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
  /** その場で作れるか（ニュースの振り分けだけ。決定記録 0033） */
  allowCreate?: boolean;
  title?: string;
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
    const local = pool.filter((e) =>
      normalizeForMatch(`${e.title}${e.workName ?? ""}`).includes(q),
    );
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
              placeholder="押すと候補が開きます。題名・作品名で探せます"
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
          dates={days}
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
  dates,
  onCancel,
  onCreated,
}: {
  initialTitle: string;
  dates: readonly string[];
  onCancel: () => void;
  onCreated: (e: { id: string; title: string }) => void;
}) {
  const { source } = useApp();
  const id = useId();
  const [kind, setKind] = useState("episode");
  const [title, setTitle] = useState(initialTitle);
  const [startsOn, setStartsOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = () => {
    if (!title.trim()) return setError("題名を入れてください");
    setBusy(true);
    setError(null);
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
        startsAt: null,
        endsAt: null,
        sources: [],
        classification: "public",
        participants: [],
      })
      .then((eventId) => onCreated({ id: eventId, title: title.trim() }))
      .catch((e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  return (
    <div className="picker-create" role="group" aria-label="出来事をその場で作る">
      <p className="picker-create-title">出来事をその場で作る</p>
      <div className="field">
        <label htmlFor={`${id}-title`}>題名</label>
        <input
          id={`${id}-title`}
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field-row">
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
      <p className="field-hint">
        公開の出来事として作り、このニュースに紐付けます。出演・作品・会場などの詳細は、出来事の画面で入れてください。
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
