// 本人の出演の確認（設計書 決定記録 0080）
//
// - 予定のまま日付を過ぎた出来事: 出演した・出ていない・中止を押すだけで直す
// - 本人の出演が付いていない出来事（日程は除く）: 予定・出演した・出ていないを押すだけで付ける。役割は選び直せる
// 押した行は一覧から外れる。作業者・運営者が付けられる（閲覧者は見るだけ）。

import { useState } from "react";
import { Link } from "react-router";
import { useApp } from "../context.tsx";
import { EVENT_KIND_SHORT, eventDateLabel, PARTICIPANT_ROLE_LABELS } from "../format.ts";
import type { ParticipantStatus, ParticipationCheckEvent } from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { useLayout } from "./Layout.tsx";

const nf = new Intl.NumberFormat("ja-JP");

/** 状態のボタン（行の中で押す順） */
const OVERDUE_ACTIONS: { status: ParticipantStatus; label: string }[] = [
  { status: "appeared", label: "出演した" },
  { status: "not_appearing", label: "出ていない" },
  { status: "cancelled", label: "中止" },
];
const MISSING_ACTIONS: { status: ParticipantStatus; label: string }[] = [
  { status: "scheduled", label: "予定" },
  { status: "appeared", label: "出演した" },
  { status: "not_appearing", label: "出ていない" },
];

function CheckRow({
  event,
  actions,
  editableRole,
  onDone,
}: {
  event: ParticipationCheckEvent;
  actions: { status: ParticipantStatus; label: string }[];
  /** 役割を選び直せるか（付いていないものだけ） */
  editableRole: boolean;
  onDone: (id: string) => void;
}) {
  const { source, viewer } = useApp();
  const [role, setRole] = useState(event.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (status: ParticipantStatus) => {
    setBusy(true);
    setError(null);
    source
      .setSubjectParticipation(event.id, status, editableRole ? role : undefined)
      .then(() => onDone(event.id))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      });
  };
  const title = event.title ?? "（題名なし）";
  return (
    <li className="check-row">
      <span className="check-date">
        {event.startsOn
          ? eventDateLabel(event.startsOn, event.endsOn, event.datePrecision)
          : "日付なし"}
      </span>
      <span className="tag">{EVENT_KIND_SHORT[event.kind] ?? event.kind}</span>
      <span className="check-title">
        <Link to={`/events/${event.id}`}>{title}</Link>
        {event.workName && <span className="quiet"> {event.workName}</span>}
      </span>
      {viewer.canWork && (
        <span className="check-actions" role="group" aria-label={`「${title}」の本人の出演`}>
          {editableRole ? (
            <select
              aria-label={`「${title}」の役割`}
              value={role}
              disabled={busy}
              onChange={(e) => setRole(e.target.value)}
            >
              {Object.entries(PARTICIPANT_ROLE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          ) : (
            <span className="quiet">{PARTICIPANT_ROLE_LABELS[event.role] ?? event.role}</span>
          )}
          {actions.map((a) => (
            <button
              key={a.status}
              type="button"
              className={`button check-${a.status}`}
              disabled={busy}
              onClick={() => set(a.status)}
            >
              {a.label}
            </button>
          ))}
        </span>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function CheckList({
  title,
  note,
  events,
  total,
  actions,
  editableRole,
  empty,
}: {
  title: string;
  note: string;
  events: ParticipationCheckEvent[];
  total: number;
  actions: { status: ParticipantStatus; label: string }[];
  editableRole: boolean;
  empty: string;
}) {
  const layout = useLayout();
  const [done, setDone] = useState<Set<string>>(new Set());
  const rest = events.filter((e) => !done.has(e.id));
  const left = Math.max(0, total - done.size);
  return (
    <section className="check-section" aria-label={title}>
      <h2 className="column-title">
        {title} <span className="work-count">{nf.format(left)} 件</span>
      </h2>
      <p className="quiet">{note}</p>
      {rest.length === 0 ? (
        <p className="quiet">{empty}</p>
      ) : (
        <ul className="check-list">
          {rest.map((e) => (
            <CheckRow
              key={e.id}
              event={e}
              actions={actions}
              editableRole={editableRole}
              onDone={(id) => {
                setDone((prev) => new Set(prev).add(id));
                layout.changed();
              }}
            />
          ))}
        </ul>
      )}
      {total > events.length && (
        <p className="quiet">
          多いため {nf.format(events.length)}{" "}
          件まで出しています。付け終えると、開き直したときに続きが出ます。
        </p>
      )}
    </section>
  );
}

export function ParticipationPage() {
  const { source } = useApp();
  const [check] = useLoad(() => source.getParticipationCheck(), [source]);
  return (
    <section className="page wide">
      <div className="page-head">
        <h1 className="page-title">出演の確認</h1>
        <p className="page-sub">
          {check.status === "ready" && check.data.subject
            ? `${check.data.subject.name} の`
            : "本人の"}
          出演を、押すだけで付けます。告知の時点で「予定」にし、出たと確かめたら「出演した」にします。本人が関わっていない出来事は「出ていない」にします。
        </p>
      </div>
      {check.status === "loading" && <p className="quiet">読み込んでいます</p>}
      {check.status === "error" && (
        <p className="error" role="alert">
          読み込めませんでした: {check.error.message}
        </p>
      )}
      {check.status === "ready" && !check.data.subject && (
        <p className="quiet">蓄積対象の人物が決まっていません。</p>
      )}
      {check.status === "ready" && check.data.subject && (
        <>
          <CheckList
            title="予定のまま日付を過ぎた出来事"
            note="放送・発売・開催の後に、出たかどうかを確かめて付けます。"
            events={check.data.overdue}
            total={check.data.counts.overdue}
            actions={OVERDUE_ACTIONS}
            editableRole={false}
            empty="予定のまま日付を過ぎた出来事はありません。"
          />
          <CheckList
            title="本人の出演が付いていない出来事"
            note="ツアーなどの日程は、まとまりに付けます。役割は種類ごとの初めの値から選び直せます。"
            events={check.data.missing}
            total={check.data.counts.missing}
            actions={MISSING_ACTIONS}
            editableRole
            empty="本人の出演が付いていない出来事はありません。"
          />
        </>
      )}
    </section>
  );
}
