// 出来事の一覧と、作る・直す画面（設計書 決定記録 0027）

import { CalendarPlus, ChevronLeft, ExternalLink, Plus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useMatch,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { EntityPicker, type Picked, PickedChip, useSearch } from "../components/EntityPicker.tsx";
import { useApp } from "../context.tsx";
import {
  EVENT_KIND_LABELS,
  EVENT_KIND_SHORT,
  EVENT_TYPE_LABELS,
  eventDateLabel,
  formatInstant,
  formatPublished,
  jstTime,
  PARTICIPANT_ROLE_LABELS,
  PARTICIPANT_STATUS_LABELS,
} from "../format.ts";
import type {
  DatePrecision,
  EventDetail,
  EventInput,
  EventSummary,
  ParticipantStatus,
  RefLabel,
  SourcePreview,
} from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { useLayout } from "./Layout.tsx";

export function EventsPage() {
  const { source, viewer } = useApp();
  const layout = useLayout();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const kind = params.get("kind") ?? "";
  const [typed, setTyped] = useState(query);
  const detail = useMatch("/events/:id");
  const [list] = useLoad(
    () => source.listEvents({ query, kind }),
    [source, query, kind, layout.version],
  );

  // 入力が落ち着いてから URL に反映して探す
  useEffect(() => {
    if (typed === query) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (typed.trim()) next.set("q", typed.trim());
      else next.delete("q");
      setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [typed, query, params, setParams]);

  if (!viewer.isMember) {
    return (
      <section className="page narrow">
        <h1 className="page-title">出来事</h1>
        <p>出来事の画面は、参加者として登録された人だけが使えます。</p>
      </section>
    );
  }

  const keep = (path: string) => (params.toString() ? `${path}?${params.toString()}` : path);

  return (
    <div className={`split ${detail ? "has-detail" : ""}`}>
      <section className="split-list" aria-label="出来事の一覧">
        <div className="page-head events-head">
          <div>
            <h1 className="page-title">出来事</h1>
            <p className="page-sub">
              仕事と公式の発表
              {list.status === "ready" && ` — 全 ${list.data.total.toLocaleString("ja-JP")} 件`}
            </p>
          </div>
          <Link to={keep("/events/new")} className="button primary">
            <CalendarPlus size={16} aria-hidden="true" />
            作る
          </Link>
        </div>
        <div className="events-filter">
          <label className="visually-hidden" htmlFor="events-q">
            題名・作品名で探す
          </label>
          <input
            id="events-q"
            type="search"
            placeholder="題名・作品名で探す"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <label className="visually-hidden" htmlFor="events-kind">
            種類で絞る
          </label>
          <select
            id="events-kind"
            value={kind}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set("kind", e.target.value);
              else next.delete("kind");
              setParams(next);
            }}
          >
            <option value="">すべての種類</option>
            {Object.entries(EVENT_KIND_SHORT).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {list.status === "loading" && <p className="quiet">読み込んでいます</p>}
        {list.status === "error" && (
          <p className="error" role="alert">
            一覧を読めませんでした: {list.error.message}
          </p>
        )}
        {list.status === "ready" && list.data.items.length === 0 && (
          <p className="empty">
            {query || kind
              ? "当てはまる出来事はありません。"
              : "まだ出来事がありません。告知を見つけたら「作る」から記録します。"}
          </p>
        )}
        {list.status === "ready" && list.data.items.length > 0 && (
          <ol className="panel event-list">
            {list.data.items.map((e) => (
              <li key={e.id}>
                <EventRow event={e} to={keep(`/events/${e.id}`)} />
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="split-detail" aria-label="出来事">
        <Outlet context={layout} />
      </section>
    </div>
  );
}

function EventRow({ event: e, to }: { event: EventSummary; to: string }) {
  return (
    <NavLink to={to} className="event-row">
      <span className="event-date">{eventDateLabel(e.startsOn, e.endsOn, e.datePrecision)}</span>
      <span className="event-title">{e.title}</span>
      <span className="event-meta">
        <span className="tag">{EVENT_KIND_SHORT[e.kind] ?? e.kind}</span>
        {e.workName && <span>{e.workName}</span>}
        {e.subjectStatus && (
          <span className={`event-status status-${e.subjectStatus}`}>
            {PARTICIPANT_STATUS_LABELS[e.subjectStatus]}
          </span>
        )}
        {!e.hasSources && <span className="tag tag-warn">出典なし</span>}
        {e.classification === "private" && <span className="tag tag-private">非公開</span>}
      </span>
    </NavLink>
  );
}

export function EventsEmpty() {
  // 出来事を消したあとは、その知らせを出す
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice ?? null;
  return (
    <>
      {notice && (
        <p className="notice event-notice" role="status">
          {notice}
        </p>
      )}
      <div className="split-empty">
        左の一覧から出来事を選ぶか、「作る」から新しく記録してください。
      </div>
    </>
  );
}

// ------------------------------------------------------------- 作る・直す

interface Row {
  key: string;
  entityId: string;
  entityName: string;
  role: string;
  status: ParticipantStatus;
  characterName: string;
  /** 蓄積対象の人物の行（最初から置く） */
  subject: boolean;
  /** 人が触っていない行は、種類・日付に合わせて役割と状態を変える */
  auto: boolean;
}

interface FormState {
  kind: string;
  eventType: string;
  title: string;
  precision: DatePrecision;
  start: string;
  end: string;
  startTime: string;
  endTime: string;
  episodeNumber: string;
  work: Picked | null;
  venue: Picked | null;
  parent: Picked | null;
  rows: Row[];
  sources: string[];
}

/** 種類ごとの、蓄積対象の人物の役割の初めの値 */
function defaultRole(kind: string): string {
  if (kind === "announcement") return "announced";
  if (kind === "cm_run" || kind === "campaign") return "model";
  if (kind === "meet_greet") return "host";
  return "performer";
}

const todayJst = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

/** 精度ごとの入力の値（日: 2026-11-05、月: 2026-11、年: 2026）を、データベースの暦日にする */
function toDate(value: string, precision: DatePrecision): string | null {
  const v = value.trim();
  if (!v) return null;
  if (precision === "year") return /^\d{4}$/.test(v) ? `${v}-01-01` : null;
  if (precision === "month") return /^\d{4}-\d{2}$/.test(v) ? `${v}-01` : null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function fromDate(value: string | null, precision: DatePrecision): string {
  if (!value) return "";
  if (precision === "year") return value.slice(0, 4);
  if (precision === "month") return value.slice(0, 7);
  return value.slice(0, 10);
}

/** 日付が過ぎていれば「出演した」、まだなら「予定」 */
function defaultStatus(start: string, precision: DatePrecision): ParticipantStatus {
  const date = toDate(start, precision);
  return date && date < todayJst() ? "appeared" : "scheduled";
}

let rowSeq = 0;
const rowKey = () => `row-${(rowSeq += 1)}`;

function emptyForm(subjects: RefLabel[], parent: Picked | null): FormState {
  return {
    kind: "episode",
    eventType: "",
    title: "",
    precision: "day",
    start: "",
    end: "",
    startTime: "",
    endTime: "",
    episodeNumber: "",
    work: null,
    venue: null,
    parent,
    rows: subjects.map((s) => ({
      key: rowKey(),
      entityId: s.id,
      entityName: s.label,
      role: defaultRole("episode"),
      status: "scheduled",
      characterName: "",
      subject: true,
      auto: true,
    })),
    sources: [""],
  };
}

function formOf(e: EventDetail, subjects: RefLabel[]): FormState {
  const precision: DatePrecision =
    e.datePrecision === "month" || e.datePrecision === "year" ? e.datePrecision : "day";
  const subjectIds = new Set(subjects.map((s) => s.id));
  return {
    kind: e.kind,
    eventType: e.eventType ?? "",
    title: e.title,
    precision,
    start: fromDate(e.startsOn, precision),
    end: fromDate(e.endsOn, precision),
    startTime: jstTime(e.startsAt),
    endTime: jstTime(e.endsAt),
    episodeNumber: e.episodeNumber === null ? "" : String(e.episodeNumber),
    work: e.workId ? { id: e.workId, label: e.workName ?? "（名前なし）" } : null,
    venue: e.venueId ? { id: e.venueId, label: e.venueName ?? "（名前なし）" } : null,
    parent: e.parentId ? { id: e.parentId, label: e.parentTitle ?? "（題名なし）" } : null,
    rows: e.participants.map((p) => ({
      key: rowKey(),
      entityId: p.entityId,
      entityName: p.entityName,
      role: p.role,
      status: p.status,
      characterName: p.characterName ?? "",
      subject: subjectIds.has(p.entityId),
      auto: false,
    })),
    sources: e.sources.length > 0 ? e.sources.map((s) => s.url) : [""],
  };
}

/** 画面の入力を、送る形にする。足りないものがあれば、その説明を返す */
function toInput(f: FormState): { input: EventInput } | { problems: string[] } {
  const problems: string[] = [];
  if (!f.title.trim()) problems.push("題名を入れてください");
  const startsOn = toDate(f.start, f.precision);
  const endsOn = toDate(f.end, f.precision);
  if (f.start.trim() && !startsOn) problems.push("始まりの日付の形が正しくありません");
  if (f.end.trim() && !endsOn) problems.push("終わりの日付の形が正しくありません");
  if (endsOn && !startsOn) problems.push("終わりの日付だけでは保存できません");
  if (startsOn && endsOn && endsOn < startsOn) problems.push("終わりの日付が始まりより前です");
  const sources = f.sources.map((s) => s.trim()).filter(Boolean);
  for (const url of sources) {
    if (!/^https?:\/\/\S+$/.test(url)) problems.push(`出典の URL の形が正しくありません: ${url}`);
  }
  const seen = new Set<string>();
  for (const r of f.rows) {
    const k = `${r.entityId}:${r.role}`;
    if (seen.has(k)) problems.push(`${r.entityName} が同じ役割で 2 回入っています`);
    seen.add(k);
  }
  const episodeNumber = f.episodeNumber.trim() ? Number(f.episodeNumber) : null;
  if (episodeNumber !== null && !(Number.isInteger(episodeNumber) && episodeNumber >= 0)) {
    problems.push("回の番号は 0 以上の整数で入れてください");
  }
  if (problems.length > 0) return { problems };
  const withTime = (time: string) =>
    f.precision === "day" && startsOn && time ? `${startsOn}T${time}:00+09:00` : null;
  return {
    input: {
      kind: f.kind,
      eventType: f.kind === "event" && f.eventType ? f.eventType : null,
      title: f.title.trim(),
      parentId: f.parent?.id ?? null,
      workId: f.work?.id ?? null,
      venueId: f.venue?.id ?? null,
      episodeNumber: f.kind === "episode" ? episodeNumber : null,
      startsOn,
      endsOn,
      datePrecision: startsOn ? f.precision : null,
      startsAt: withTime(f.startTime),
      endsAt:
        f.precision === "day" && endsOn === null && f.endTime && startsOn
          ? `${startsOn}T${f.endTime}:00+09:00`
          : null,
      sources: sources.map((url) => ({ url })),
      // 出来事は仕事と公式の発表だけなので、すべて公開（設計書 決定記録 0029）
      classification: "public",
      participants: f.rows.map((r) => ({
        entityId: r.entityId,
        role: r.role,
        status: r.status,
        characterName: r.role === "cast" && r.characterName.trim() ? r.characterName.trim() : null,
      })),
    },
  };
}

export function EventEditPage() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const { source } = useApp();
  const layout = useLayout();
  const [params] = useSearchParams();
  const parentId = params.get("parent");
  const [loaded, reload] = useLoad(async () => {
    const subjects = await source.listArchiveSubjects();
    if (isNew) {
      const parent = parentId ? await source.getEvent(parentId).catch(() => null) : null;
      return {
        detail: null,
        subjects,
        form: emptyForm(subjects, parent ? { id: parent.id, label: parent.title } : null),
      };
    }
    const detail = await source.getEvent(id);
    return { detail, subjects, form: formOf(detail, subjects) };
  }, [source, id, parentId]);

  // 保存したことの知らせ（作ったあとは、作った出来事の画面に移ってから出す）
  const location = useLocation();
  const [saved, setSaved] = useState<{ key: string; text: string } | null>(null);
  const notice =
    saved?.key === location.key
      ? saved.text
      : ((location.state as { notice?: string } | null)?.notice ?? null);

  if (loaded.status === "loading") return <p className="quiet">読み込んでいます</p>;
  if (loaded.status === "error") {
    return (
      <p className="error" role="alert">
        出来事を読めませんでした: {loaded.error.message}
      </p>
    );
  }
  return (
    <>
      {notice && (
        <p className="notice event-notice" role="status">
          {notice}
        </p>
      )}
      <EventForm
        key={id ?? "new"}
        detail={loaded.data.detail}
        initial={loaded.data.form}
        onSaved={(text) => {
          setSaved({ key: location.key, text });
          layout.changed();
          reload();
        }}
      />
    </>
  );
}

function EventForm({
  detail,
  initial,
  onSaved,
}: {
  detail: EventDetail | null;
  initial: FormState;
  onSaved: (notice: string) => void;
}) {
  const { source } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const formId = useId();
  const [f, setF] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const layoutChanged = useLayout().changed;
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }));
  // 人が触っていない行の役割・状態を、種類と日付に合わせる
  const retune = (next: FormState): FormState => ({
    ...next,
    rows: next.rows.map((r) =>
      r.auto
        ? { ...r, role: defaultRole(next.kind), status: defaultStatus(next.start, next.precision) }
        : r,
    ),
  });
  const setRow = (key: string, patch: Partial<Row>) =>
    setF((s) => ({
      ...s,
      rows: s.rows.map((r) => (r.key === key ? { ...r, ...patch, auto: false } : r)),
    }));

  const save = () => {
    const result = toInput(f);
    if ("problems" in result) {
      setProblems(result.problems);
      setMessage(null);
      return;
    }
    setProblems([]);
    setBusy(true);
    source
      .saveEvent(detail?.id ?? null, result.input)
      .then((savedId) => {
        if (detail) {
          onSaved("直しました");
          return;
        }
        const keep = new URLSearchParams(params);
        keep.delete("parent");
        layoutChanged();
        void navigate(`/events/${savedId}${keep.toString() ? `?${keep.toString()}` : ""}`, {
          state: { notice: "作りました" },
        });
      })
      .catch((e: unknown) =>
        setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) }),
      )
      .finally(() => setBusy(false));
  };

  const precisionInput =
    f.precision === "day" ? "date" : f.precision === "month" ? "month" : "number";

  return (
    <form
      className="panel panel-pad event-form"
      aria-labelledby={`${formId}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="event-form-head">
        <Link className="back-link" to={{ pathname: "/events", search: listSearch(params) }}>
          <ChevronLeft size={16} aria-hidden="true" />
          一覧に戻る
        </Link>
        <h2 id={`${formId}-title`} className="column-title">
          {detail ? "出来事を直す" : "出来事を作る"}
        </h2>
        {detail && (
          <p className="quiet event-stamp">
            {detail.createdByName ? `${detail.createdByName} が作成` : "取り込みで作成"}（
            {formatInstant(detail.createdAt)}）
            {detail.updatedAt !== detail.createdAt &&
              ` ・ ${detail.updatedByName ?? "取り込み"} が ${formatInstant(detail.updatedAt)} に直した`}
          </p>
        )}
        {detail && detail.materials.length > 0 && (
          <p className="event-material-count">
            <a href={`#${formId}-materials`}>紐付いている素材 {detail.materials.length} 件</a>
          </p>
        )}
      </div>

      <fieldset className="editor" disabled={busy}>
        <section className="editor-section">
          <div className="field-row">
            <div className="field grow">
              <label htmlFor={`${formId}-kind`}>種類</label>
              <select
                id={`${formId}-kind`}
                value={f.kind}
                onChange={(e) => setF((s) => retune({ ...s, kind: e.target.value }))}
              >
                {Object.entries(EVENT_KIND_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
                {!EVENT_KIND_LABELS[f.kind] && <option value={f.kind}>{f.kind}</option>}
              </select>
            </div>
            {f.kind === "event" && (
              <div className="field grow">
                <label htmlFor={`${formId}-event-type`}>イベントの種類</label>
                <select
                  id={`${formId}-event-type`}
                  value={f.eventType}
                  onChange={(e) => set({ eventType: e.target.value })}
                >
                  <option value="">選ばない</option>
                  {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor={`${formId}-name`}>題名</label>
            <input
              id={`${formId}-name`}
              value={f.title}
              placeholder="例: 番組名 第 12 回 / 誌名 12 月号 / ツアー名 東京 1 日目"
              onChange={(e) => set({ title: e.target.value })}
            />
          </div>
        </section>

        <section className="editor-section" aria-labelledby={`${formId}-when`}>
          <h2 id={`${formId}-when`}>いつ</h2>
          <div className="field">
            <span className="field-label" id={`${formId}-precision`}>
              日付の細かさ
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby={`${formId}-precision`}>
              {(
                [
                  ["day", "日"],
                  ["month", "月"],
                  ["year", "年"],
                ] as const
              ).map(([v, l]) => (
                <label key={v} className="segment">
                  <input
                    type="radio"
                    name={`${formId}-precision`}
                    checked={f.precision === v}
                    onChange={() => {
                      const startsOn = toDate(f.start, f.precision);
                      const endsOn = toDate(f.end, f.precision);
                      setF((s) =>
                        retune({
                          ...s,
                          precision: v,
                          start: fromDate(startsOn, v),
                          end: fromDate(endsOn, v),
                        }),
                      );
                    }}
                  />
                  <span>{l}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${formId}-start`}>{f.end ? "始まり" : "日付"}</label>
              <input
                id={`${formId}-start`}
                type={precisionInput}
                {...(precisionInput === "number"
                  ? { min: 1900, max: 2200, placeholder: "2026" }
                  : {})}
                value={f.start}
                onChange={(e) => setF((s) => retune({ ...s, start: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-end`}>終わり（期間のとき）</label>
              <input
                id={`${formId}-end`}
                type={precisionInput}
                {...(precisionInput === "number" ? { min: 1900, max: 2200 } : {})}
                value={f.end}
                onChange={(e) => set({ end: e.target.value })}
              />
            </div>
          </div>
          {f.precision === "day" && (
            <div className="field-row">
              <div className="field">
                <label htmlFor={`${formId}-start-time`}>開始の時刻（任意）</label>
                <input
                  id={`${formId}-start-time`}
                  type="time"
                  value={f.startTime}
                  onChange={(e) => set({ startTime: e.target.value })}
                />
              </div>
              {!f.end && (
                <div className="field">
                  <label htmlFor={`${formId}-end-time`}>終了の時刻（任意）</label>
                  <input
                    id={`${formId}-end-time`}
                    type="time"
                    value={f.endTime}
                    onChange={(e) => set({ endTime: e.target.value })}
                  />
                </div>
              )}
            </div>
          )}
        </section>

        <section className="editor-section" aria-labelledby={`${formId}-what`}>
          <h2 id={`${formId}-what`}>作品・会場・まとまり</h2>
          <div className="field-row picker-row">
            <EntityPicker
              label="作品（番組・雑誌・CM など）"
              types={["work"]}
              createType="work"
              defaultSubtype={
                f.kind === "publication" ? "magazine" : f.kind === "cm_run" ? "cm" : "tv_program"
              }
              value={f.work}
              onChange={(work) => set({ work })}
            />
            {f.kind === "episode" && (
              <div className="field narrow-field">
                <label htmlFor={`${formId}-episode`}>回の番号</label>
                <input
                  id={`${formId}-episode`}
                  inputMode="numeric"
                  value={f.episodeNumber}
                  onChange={(e) => set({ episodeNumber: e.target.value })}
                />
              </div>
            )}
          </div>
          <EntityPicker
            label="会場"
            types={["place"]}
            createType="place"
            defaultSubtype="venue"
            value={f.venue}
            onChange={(venue) => set({ venue })}
          />
          <ParentPicker
            selfId={detail?.id ?? null}
            value={f.parent}
            onChange={(parent) => set({ parent })}
          />
          {detail && detail.children.length > 0 && (
            <div className="field">
              <span className="field-label">この出来事の下の出来事</span>
              <ul className="event-children">
                {detail.children.map((c) => (
                  <li key={c.id}>
                    <Link to={`/events/${c.id}`}>{c.title}</Link>
                    <span className="quiet">
                      {eventDateLabel(c.startsOn, null, c.datePrecision)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {detail && (
            <Link to={`/events/new?parent=${detail.id}`} className="link-button event-add-child">
              この出来事の下に作る（各公演・各回など）
            </Link>
          )}
        </section>

        <section className="editor-section" aria-labelledby={`${formId}-who`}>
          <h2 id={`${formId}-who`}>出演</h2>
          {f.rows.length === 0 && <p className="quiet">出演はまだ付いていません。</p>}
          {f.rows.length > 0 && (
            <ul className="participant-list">
              {f.rows.map((r) => (
                <li key={r.key} className="participant">
                  <span className="participant-name">
                    {r.entityName}
                    {r.subject && <span className="quiet">（蓄積対象）</span>}
                  </span>
                  <label className="visually-hidden" htmlFor={`${r.key}-role`}>
                    {r.entityName} の役割
                  </label>
                  <select
                    id={`${r.key}-role`}
                    value={r.role}
                    onChange={(e) => setRow(r.key, { role: e.target.value })}
                  >
                    {Object.entries(PARTICIPANT_ROLE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                    {!PARTICIPANT_ROLE_LABELS[r.role] && <option value={r.role}>{r.role}</option>}
                  </select>
                  <label className="visually-hidden" htmlFor={`${r.key}-status`}>
                    {r.entityName} の出演の状態
                  </label>
                  <select
                    id={`${r.key}-status`}
                    value={r.status}
                    className={`status-select status-${r.status}`}
                    onChange={(e) => setRow(r.key, { status: e.target.value as ParticipantStatus })}
                  >
                    {Object.entries(PARTICIPANT_STATUS_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  {r.role === "cast" && (
                    <>
                      <label className="visually-hidden" htmlFor={`${r.key}-character`}>
                        {r.entityName} の役名
                      </label>
                      <input
                        id={`${r.key}-character`}
                        placeholder="役名"
                        value={r.characterName}
                        onChange={(e) => setRow(r.key, { characterName: e.target.value })}
                      />
                    </>
                  )}
                  <button
                    type="button"
                    className="icon-button participant-remove"
                    aria-label={`${r.entityName} を出演から外す`}
                    onClick={() =>
                      setF((s) => ({ ...s, rows: s.rows.filter((x) => x.key !== r.key) }))
                    }
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <EntityPicker
            label="出演者を足す（メンバー・共演者）"
            types={["person", "group"]}
            createType="person"
            defaultSubtype="talent"
            value={null}
            addMode
            exclude={[]}
            onChange={(picked) => {
              if (!picked) return;
              setF((s) => ({
                ...s,
                rows: [
                  ...s.rows,
                  {
                    key: rowKey(),
                    entityId: picked.id,
                    entityName: picked.label,
                    role: defaultRole(s.kind),
                    status: defaultStatus(s.start, s.precision),
                    characterName: "",
                    subject: false,
                    auto: false,
                  },
                ],
              }));
            }}
          />
        </section>

        <section className="editor-section" aria-labelledby={`${formId}-sources`}>
          <h2 id={`${formId}-sources`}>出典</h2>
          {detail && <EventMaterials id={`${formId}-materials`} detail={detail} />}
          <p className="field-hint">
            {detail && detail.materials.length > 0
              ? "ほかに出典があれば URL を足せます（任意）。"
              : "公式の告知・お知らせなどの URL（任意）。振り分け・承認でニュースや投稿を紐付けると、上に並びます。"}
          </p>
          {f.sources.map((url, i) => (
            <div key={i} className="source-item">
              <div className="source-row">
                <label className="visually-hidden" htmlFor={`${formId}-source-${i}`}>
                  出典の URL {i + 1}
                </label>
                <input
                  id={`${formId}-source-${i}`}
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={url}
                  onChange={(e) =>
                    set({ sources: f.sources.map((s, j) => (j === i ? e.target.value : s)) })
                  }
                />
                {f.sources.length > 1 && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`出典の URL ${i + 1} を外す`}
                    onClick={() => set({ sources: f.sources.filter((_, j) => j !== i) })}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
              <SourcePreviewLine url={url} />
            </div>
          ))}
          <button
            type="button"
            className="link-button event-add-source"
            onClick={() => set({ sources: [...f.sources, ""] })}
          >
            <Plus size={14} aria-hidden="true" /> URL を足す
          </button>
        </section>
      </fieldset>

      {problems.length > 0 && (
        <ul className="form-problems" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {message && (
        <p
          className={message.kind === "error" ? "error" : "quiet"}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
      <div className="event-form-actions">
        {detail && <DeleteEvent detail={detail} />}
        {!detail && (
          <Link to="/events" className="button">
            やめる
          </Link>
        )}
        <button type="submit" className="button primary" disabled={busy}>
          {detail ? "直す" : "作る"}
        </button>
      </div>
    </form>
  );
}

/**
 * 出来事を消す（管理者と作った本人。素材が紐付いていないときだけ。設計書 決定記録 0030）。
 * 押すとその場で確かめてから消す。消す前の状態は変更履歴に残る
 */
const PREVIEW_STATE: Record<SourcePreview["state"], string | null> = {
  saved: null,
  triage: "振り分け待ち",
  pending: "承認待ち",
  on_hold: "保留中",
};

/**
 * 出典の URL の見出し。取り込み済みの素材（保存済み・振り分け待ち・承認待ち）から探し、外のサイトには
 * 取りに行かない（設計書 決定記録 0030）
 */
function SourcePreviewLine({ url }: { url: string }) {
  const { source } = useApp();
  const target = /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url.trim()) ? url.trim() : "";
  const found = useSearch<SourcePreview | null>(target, async (u) => [
    await source.previewSource(u),
  ]);
  if (!target || !found) return null;
  const p = found[0] ?? null;
  if (!p) {
    return (
      <p className="quiet source-preview is-none">
        取り込み済みの素材には見つかりません。URL はそのまま出典に残ります。
      </p>
    );
  }
  const title = p.title?.trim() || "（題名なし）";
  const date = formatPublished(p);
  const state = PREVIEW_STATE[p.state];
  return (
    <div className="source-preview" aria-label="出典の見出し">
      <span className="event-material-channel">{p.channelName}</span>
      {p.postId ? (
        <Link to={`/posts/${p.postId}`} className="event-material-title">
          {title}
        </Link>
      ) : (
        <span className="event-material-title">{title}</span>
      )}
      {date && <span className="quiet event-material-date">{date}</span>}
      {state && <span className="tag source-preview-state">{state}</span>}
    </div>
  );
}

/** 出来事に紐付いた素材（振り分け・承認で紐付けたニュース・ブログなど） */
function EventMaterials({ id, detail }: { id: string; detail: EventDetail }) {
  const { materials } = detail;
  return (
    <div className="event-materials" id={id}>
      <h3>紐付いている素材（{materials.length} 件）</h3>
      {materials.length === 0 ? (
        <p className="quiet">まだありません。</p>
      ) : (
        <ul>
          {materials.map((m, i) => {
            const title = m.title?.trim() || "（題名なし）";
            const date = formatPublished(m);
            return (
              <li key={m.postId ?? `${m.url ?? ""}-${i}`}>
                <span className="event-material-channel">{m.channelName}</span>
                {m.postId ? (
                  <Link to={`/posts/${m.postId}`} className="event-material-title">
                    {title}
                  </Link>
                ) : (
                  <span className="event-material-title">{title}</span>
                )}
                {date && <span className="quiet event-material-date">{date}</span>}
                {m.url && (
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="icon-button event-material-open"
                    aria-label={`「${title}」の元のページを開く`}
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DeleteEvent({ detail }: { detail: EventDetail }) {
  const { source } = useApp();
  const layout = useLayout();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { links, drafts, children } = detail.usage;

  if (!detail.canDelete) {
    const reason =
      links + drafts > 0
        ? `素材が ${links + drafts} 件紐付いているため、消せません`
        : children > 0
          ? `下の出来事が ${children} 件あるため、消せません`
          : "消せるのは、管理者とこの出来事を作った人だけです";
    return <span className="event-delete-note">{reason}</span>;
  }
  if (!asking) {
    return (
      <button type="button" className="button danger event-delete" onClick={() => setAsking(true)}>
        この出来事を消す
      </button>
    );
  }
  return (
    <span className="event-delete-confirm" role="group" aria-label="出来事を消すかの確認">
      <span>「{detail.title}」を消しますか？</span>
      <button type="button" className="button" disabled={busy} onClick={() => setAsking(false)}>
        やめる
      </button>
      <button
        type="button"
        className="button danger"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          source
            .deleteEvent(detail.id)
            .then(() => {
              layout.changed();
              void navigate(
                { pathname: "/events", search: listSearch(params) },
                { state: { notice: `「${detail.title}」を消しました` } },
              );
            })
            .catch((e: unknown) => {
              setBusy(false);
              setError(e instanceof Error ? e.message : String(e));
            });
        }}
      >
        消す
      </button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

/** 一覧の絞り込み（探す文字・種類）だけを残す */
function listSearch(params: URLSearchParams): string {
  const keep = new URLSearchParams();
  for (const k of ["q", "kind"]) {
    const v = params.get(k);
    if (v) keep.set(k, v);
  }
  return keep.toString();
}

/** 親の出来事を題名で探して選ぶ */
function ParentPicker({
  selfId,
  value,
  onChange,
}: {
  selfId: string | null;
  value: Picked | null;
  onChange: (picked: Picked | null) => void;
}) {
  const { source } = useApp();
  const id = useId();
  const [query, setQuery] = useState("");
  const found = useSearch<EventSummary>(query, async (q) =>
    (await source.listEvents({ query: q })).items.filter((e) => e.id !== selfId),
  );
  if (value) {
    return (
      <div className="field">
        <span className="field-label">親の出来事（ツアー・番組の放送期間など）</span>
        <div>
          <PickedChip
            label={value.label}
            clearLabel="親の出来事を外す"
            onClear={() => onChange(null)}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="field picker">
      <label htmlFor={id}>親の出来事（ツアー・番組の放送期間など。任意）</label>
      <input
        id={id}
        type="search"
        value={query}
        placeholder="題名で探す"
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim() && found && (
        <ul className="picker-results" aria-label="親の出来事の候補">
          {found.length === 0 && <li className="quiet picker-none">見つかりませんでした</li>}
          {found.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="picker-option"
                onClick={() => {
                  onChange({ id: e.id, label: e.title });
                  setQuery("");
                }}
              >
                <span>{e.title}</span>
                <span className="quiet">
                  {eventDateLabel(e.startsOn, e.endsOn, e.datePrecision)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
