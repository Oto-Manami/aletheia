// 出来事のセットリストと曲ごとの参加（設計書 決定記録 0060）
//
// - 日程を持たない出来事（歌番組の回・配信・1 回だけのライブなど）は、その出来事のセットリスト
// - 日程を持つまとまり（ツアー・フェスなど）は「日程」の一覧。日程を押すとその場で開き、会場・出演・
//   セットリスト・曲ごとの参加を見る・直す（日程の専用の画面は持たない）
// - 曲ごとに、蓄積対象の人物の参加を押して切り替える（未確認 → 参加 → 不参加 → 未確認）
// - セットリストは 1 行 1 曲の文字で書いて入れる。ほかの日程の並びを写してから直せる

import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useApp } from "../context.tsx";
import { eventDateLabel, jstTime, PARTICIPANT_STATUS_LABELS } from "../format.ts";
import { formatSetlist, parseSetlist, songIndex, unmatchedSongs } from "../source/setlist.ts";
import type {
  EventDetail,
  EventSetlist,
  EventSetlistsView,
  ItemParticipation,
  SetlistItem,
  SongSummary,
} from "../source/types.ts";
import { useLoad } from "../use-load.ts";

const PARTICIPATION_LABELS: Record<string, string> = {
  appeared: "参加",
  not_appearing: "不参加",
  unknown: "未確認",
};

/** 押したときの次の状態（未確認 → 参加 → 不参加 → 未確認） */
export function nextParticipation(status: ItemParticipation): ItemParticipation {
  if (status === null) return "appeared";
  if (status === "appeared") return "not_appearing";
  return null;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function setlistLabel(s: EventSetlist): string {
  return [s.startsOn, s.part].filter(Boolean).join(" ") || (s.title ?? "日程");
}

/** セットリスト 1 つ（見る・曲ごとの参加・文字で書いて入れる） */
export function SetlistBlock({
  setlist,
  others,
  subject,
  songs,
  onSaved,
}: {
  setlist: EventSetlist;
  /** 写せるほかの並び */
  others: EventSetlist[];
  subject: { id: string; name: string } | null;
  songs: readonly SongSummary[] | null;
  onSaved: () => void;
}) {
  const { source, viewer } = useApp();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 押した直後の参加（読み直すまでの間）
  const [marks, setMarks] = useState<Record<string, ItemParticipation>>({});
  const index = useMemo(() => songIndex(songs ?? []), [songs]);
  const parsed = text === null ? null : parseSetlist(text, index, setlist.items);
  const missing = parsed ? unmatchedSongs(parsed) : [];
  const canEdit = viewer.canWork && !!source.saveEventItems;
  const canMark = viewer.canWork && !!subject && !!source.setItemParticipation;
  const statusOf = (i: SetlistItem): ItemParticipation =>
    i.id && i.id in marks ? (marks[i.id] ?? null) : (i.subjectStatus ?? null);
  const songsOnly = setlist.items.filter((i) => i.itemType === "song");
  const counts = { appeared: 0, not_appearing: 0, unknown: 0 };
  for (const i of songsOnly) counts[statusOf(i) ?? "unknown"]++;

  const save = async () => {
    if (!parsed || !source.saveEventItems) return;
    setSaving(true);
    setError(null);
    try {
      await source.saveEventItems(setlist.eventId, parsed);
      setText(null);
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  };

  const mark = async (item: SetlistItem) => {
    if (!item.id || !subject || !source.setItemParticipation) return;
    const next = nextParticipation(statusOf(item));
    setMarks((m) => ({ ...m, [item.id!]: next }));
    try {
      await source.setItemParticipation(item.id, subject.id, next);
    } catch (e) {
      setMarks((m) => {
        const rest = { ...m };
        delete rest[item.id!];
        return rest;
      });
      setError(message(e));
    }
  };

  let n = 0;
  return (
    <div className="setlist-block">
      {text === null ? (
        setlist.items.length === 0 ? (
          <p className="quiet">セットリストはまだありません。</p>
        ) : (
          <>
            {subject && songsOnly.length > 0 && (
              <p className="quiet setlist-summary">
                {subject.name}: 参加 {counts.appeared}・不参加 {counts.not_appearing}・未確認{" "}
                {counts.unknown}
              </p>
            )}
            <ol className="setlist">
              {setlist.items.map((i, k) => {
                const name = i.workName ?? i.title ?? "";
                if (i.itemType === "section") {
                  return (
                    <li key={i.id ?? k} className="setlist-section">
                      {name}
                    </li>
                  );
                }
                if (i.itemType !== "song") {
                  return (
                    <li key={i.id ?? k} className="setlist-other quiet">
                      {name}
                    </li>
                  );
                }
                n++;
                const status = statusOf(i);
                const label = PARTICIPATION_LABELS[status ?? "unknown"];
                return (
                  <li key={i.id ?? k} className="setlist-song">
                    <span className="setlist-no">M{n}</span>
                    <span className="setlist-name">{name}</span>
                    {!i.workId && <span className="tag">楽曲リストに無い曲</span>}
                    {i.note && <span className="quiet">{i.note}</span>}
                    {subject &&
                      (canMark ? (
                        <button
                          type="button"
                          className={`participation is-${status ?? "unknown"}`}
                          aria-label={`${name} の${subject.name}の参加: ${label}（押すと切り替える）`}
                          onClick={() => void mark(i)}
                        >
                          {label}
                        </button>
                      ) : (
                        <span className={`participation is-${status ?? "unknown"}`}>{label}</span>
                      ))}
                  </li>
                );
              })}
            </ol>
          </>
        )
      ) : (
        <div className="setlist-edit">
          {others.length > 0 && (
            <label className="setlist-copy">
              ほかの日程から写す
              <select
                value=""
                onChange={(e) => {
                  const from = others.find((o) => o.eventId === e.target.value);
                  if (from) setText(formatSetlist(from.items));
                }}
              >
                <option value="">選ぶ</option>
                {others.map((o) => (
                  <option key={o.eventId} value={o.eventId}>
                    {o.isLegacy ? "以前の全公演で共通の曲" : setlistLabel(o)}（{o.items.length} 行）
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="visually-hidden" htmlFor={`setlist-${setlist.eventId}`}>
            {setlistLabel(setlist)} のセットリスト
          </label>
          <textarea
            id={`setlist-${setlist.eventId}`}
            rows={Math.max(8, setlist.items.length + 2)}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
          <p className="field-hint">
            1 行に 1 曲。「アンコール」や【】で囲んだ行は区切り、「MC」で始まる行は
            MC。行頭の番号（M1. など）は読み飛ばし、行末の（）はメモにします。
          </p>
          {songs === null && (
            <p className="field-hint">楽曲リストを読めないため、曲名だけで入れます。</p>
          )}
          {missing.length > 0 && songs !== null && (
            <p className="notice">
              楽曲リストに無い曲が {missing.length} 曲あります（曲名だけで入れます）:{" "}
              {missing.join("、")}
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              className="button primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "保存しています" : "保存"}
            </button>
            <button type="button" className="button" onClick={() => setText(null)}>
              やめる
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          保存できませんでした: {error}
        </p>
      )}
      {canEdit && text === null && (
        <button
          type="button"
          className="link-button"
          onClick={() => setText(formatSetlist(setlist.items))}
        >
          <Pencil size={14} aria-hidden="true" />
          {setlist.items.length === 0 ? "セットリストを書く" : "文字で直す"}
        </button>
      )}
    </div>
  );
}

/** 以前にまとまりに置いた「全公演で共通の曲」。曲の無い日程に写してから外す */
function LegacySetlist({
  legacy,
  schedules,
  onDone,
}: {
  legacy: EventSetlist;
  schedules: EventSetlist[];
  onDone: () => void;
}) {
  const { source, viewer } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = schedules.filter((s) => s.items.length === 0);
  if (!viewer.canWork || !source.saveEventItems) return null;
  const run = async (copy: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (copy) {
        const items = legacy.items.map((i) => ({ ...i, id: null, subjectStatus: null }));
        for (const s of empty) await source.saveEventItems!(s.eventId, items);
      }
      await source.saveEventItems!(legacy.eventId, []);
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="notice setlist-legacy">
      <p>
        以前の「全公演で共通の曲」（{legacy.items.length}{" "}
        行）が残っています。セットリストは日程ごとに持つので、 日程に写してから外します。
      </p>
      <div className="actions">
        <button
          type="button"
          className="button"
          disabled={busy || empty.length === 0}
          onClick={() => void run(true)}
        >
          曲の無い日程（{empty.length} 件）に写して外す
        </button>
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={() => void run(false)}
        >
          写さずに外す
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          できませんでした: {error}
        </p>
      )}
    </div>
  );
}

function whenOf(c: EventDetail["children"][number]): string {
  const date = eventDateLabel(c.startsOn, c.endsOn, c.datePrecision);
  const time = jstTime(c.startsAt);
  return time ? `${date} ${time}` : date;
}

/** 出来事の画面のセットリストの欄（日程を持つまとまりは、日程の一覧） */
export function EventSetlistsSection({
  detail,
  focus,
  search,
}: {
  detail: EventDetail;
  /** 開いておく日程 */
  focus: string | null;
  search: string;
}) {
  const { source, viewer } = useApp();
  const [view, reload] = useLoad(
    () =>
      source.getEventSetlists
        ? source.getEventSetlists(detail.id)
        : Promise.resolve<EventSetlistsView | null>(null),
    [source, detail.id],
  );
  const [songs] = useLoad(
    () =>
      source.listSongs
        ? source.listSongs().then((l) => l.songs)
        : Promise.resolve<SongSummary[] | null>(null),
    [source],
  );
  const [open, setOpen] = useState<string | null>(focus);
  const songList = songs.status === "ready" ? songs.data : null;
  const data = view.status === "ready" ? view.data : null;
  const schedules = data?.setlists.filter((s) => s.isSchedule) ?? [];
  const legacy = data?.setlists.find((s) => s.isLegacy) ?? null;

  if (detail.children.length > 0) {
    return (
      <section className="event-view-section" aria-labelledby="event-view-children">
        <h3 id="event-view-children">日程（{detail.children.length} 件）</h3>
        {legacy && <LegacySetlist legacy={legacy} schedules={schedules} onDone={reload} />}
        <ul className="schedule-list">
          {detail.children.map((c) => {
            const isOpen = open === c.id;
            const setlist = schedules.find((s) => s.eventId === c.id);
            const songCount = setlist?.items.filter((i) => i.itemType === "song").length ?? 0;
            return (
              <li key={c.id} className={`schedule-row ${isOpen ? "is-open" : ""}`}>
                <button
                  type="button"
                  className="schedule-head"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : c.id)}
                >
                  {isOpen ? (
                    <ChevronDown size={16} aria-hidden="true" />
                  ) : (
                    <ChevronRight size={16} aria-hidden="true" />
                  )}
                  <span className="quiet event-material-date">{whenOf(c)}</span>
                  <span className="schedule-title">
                    {c.part ?? c.title}
                    {c.venueName && <span className="quiet"> {c.venueName}</span>}
                  </span>
                  {songCount > 0 && <span className="quiet">{songCount} 曲</span>}
                  {c.subjectStatus && (
                    <span className={`event-status status-${c.subjectStatus}`}>
                      {PARTICIPANT_STATUS_LABELS[c.subjectStatus]}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div className="schedule-body">
                    {viewer.canWork && (
                      <Link
                        className="link-button"
                        to={{ pathname: `/events/${c.id}/edit`, search }}
                      >
                        <Pencil size={14} aria-hidden="true" />
                        日付・会場・出演を直す
                      </Link>
                    )}
                    {view.status === "loading" && <p className="quiet">読み込んでいます</p>}
                    {view.status === "error" && (
                      <p className="error" role="alert">
                        セットリストを読めませんでした: {view.error.message}
                      </p>
                    )}
                    {setlist && data && (
                      <SetlistBlock
                        setlist={setlist}
                        others={data.setlists.filter(
                          (s) => s.eventId !== c.id && s.items.length > 0,
                        )}
                        subject={data.subject}
                        songs={songList}
                        onSaved={reload}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  if (!source.getEventSetlists) return null;
  const own = data?.setlists[0];
  return (
    <section className="event-view-section" aria-labelledby="event-view-setlist">
      <h3 id="event-view-setlist">セットリスト</h3>
      {view.status === "loading" && <p className="quiet">読み込んでいます</p>}
      {view.status === "error" && (
        <p className="error" role="alert">
          セットリストを読めませんでした: {view.error.message}
        </p>
      )}
      {own && data && (
        <SetlistBlock
          setlist={own}
          others={[]}
          subject={data.subject}
          songs={songList}
          onSaved={reload}
        />
      )}
    </section>
  );
}
