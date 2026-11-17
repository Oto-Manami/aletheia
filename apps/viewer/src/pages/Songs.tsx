// 楽曲リスト（設計書 決定記録 0059）
//
// 左にシングル・アルバムごとの収録曲（曲ごとの披露・参加の回数つき）、右に選んだ曲（収録されたシングル・
// アルバムと、披露の回数を歌った場の種類ごとに・披露の履歴と参加。決定記録 0060）。
// 運営者は、楽曲リストをまとめて入れられる（何度入れても重ならない）。

import { Music } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useParams } from "react-router";
import { useApp } from "../context.tsx";
import { EVENT_KIND_SHORT } from "../format.ts";
import type {
  SongDetail,
  SongImportResult,
  SongList,
  SongRelease,
  SongSummary,
} from "../source/types.ts";
import { useLoad } from "../use-load.ts";

const RELEASE_LABELS: Record<string, string> = { single: "シングル", album: "アルバム" };

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const STATUS_LABELS: Record<string, string> = {
  appeared: "参加",
  not_appearing: "不参加",
  unknown: "未確認",
};

/** 披露 n 回（参加 m） */
function countLabel(s: SongSummary | undefined, subject: boolean): string {
  if (!s || s.performed === 0) return "";
  return subject ? `披露 ${s.performed}・参加 ${s.appeared}` : `披露 ${s.performed}`;
}

function ReleaseBlock({
  release,
  counts,
  subject,
}: {
  release: SongRelease;
  counts: Map<string, SongSummary>;
  subject: boolean;
}) {
  return (
    <li className="song-release">
      <p className="song-release-head">
        <span className="song-release-kind">
          {RELEASE_LABELS[release.subtype] ?? release.subtype}
        </span>
        <span className="song-release-name">{release.name}</span>
        {release.releasedOn && <span className="quiet">{release.releasedOn}</span>}
      </p>
      <ol className="song-tracks">
        {release.tracks.map((t) => (
          <li key={t.songId}>
            <NavLink to={`/songs/${t.songId}`} className="song-track">
              <span className="song-track-no">{t.position ?? "-"}</span>
              <span className="song-track-name">{t.name}</span>
              {t.isTitle && <span className="tag">表題曲</span>}
              {countLabel(counts.get(t.songId), subject) && (
                <span className="quiet song-count">
                  {countLabel(counts.get(t.songId), subject)}
                </span>
              )}
            </NavLink>
          </li>
        ))}
      </ol>
    </li>
  );
}

/** 運営者が、楽曲リスト（JSON）をまとめて入れる */
function SongImport({ onDone }: { onDone: () => void }) {
  const { source } = useApp();
  const [text, setText] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "sending" }
    | { kind: "done"; result: SongImportResult }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  if (!source.importSongs) return null;
  const send = async () => {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      setState({ kind: "error", message: "JSON として読めません" });
      return;
    }
    setState({ kind: "sending" });
    try {
      const result = await source.importSongs!(data);
      setState({ kind: "done", result });
      onDone();
    } catch (e) {
      setState({ kind: "error", message: message(e) });
    }
  };
  return (
    <details className="panel panel-pad song-import">
      <summary>楽曲リストをまとめて入れる（運営者）</summary>
      <p className="field-hint">
        確かめた楽曲リストの JSON（releases:
        シングル・アルバムと収録曲）を貼ります。何度入れても重ならず、 変わったところだけ直します。
      </p>
      <label className="visually-hidden" htmlFor="song-import">
        楽曲リストの JSON
      </label>
      <textarea
        id="song-import"
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      <div className="actions">
        <button
          type="button"
          className="button primary"
          disabled={!text.trim() || state.kind === "sending"}
          onClick={() => void send()}
        >
          {state.kind === "sending" ? "入れています" : "入れる"}
        </button>
        {state.kind === "done" && (
          <p role="status">
            {`シングル・アルバム ${state.result.releases.created} 件を足し ${state.result.releases.updated} 件を直しました。`}
            {`楽曲 ${state.result.songs.created} 曲を足し、収録 ${state.result.tracks.created} 件を足し ${state.result.tracks.updated} 件を直しました。`}
          </p>
        )}
        {state.kind === "error" && (
          <p className="error" role="alert">
            入れられませんでした: {state.message}
          </p>
        )}
      </div>
    </details>
  );
}

/** 歌った場の種類（日程は、まとまりの種類で数える） */
function placeOf(p: SongDetail["performances"][number]): string {
  return EVENT_KIND_SHORT[p.parentKind ?? p.kind] ?? p.parentKind ?? p.kind;
}

/** 披露の回数（歌った場の種類ごと）と履歴。蓄積対象の人物の参加つき（決定記録 0060） */
function Performances({ song }: { song: SongDetail }) {
  const rows = song.performances;
  const groups = new Map<string, { total: number; appeared: number; notAppearing: number }>();
  for (const p of rows) {
    const g = groups.get(placeOf(p)) ?? { total: 0, appeared: 0, notAppearing: 0 };
    g.total++;
    if (p.subjectStatus === "appeared") g.appeared++;
    if (p.subjectStatus === "not_appearing") g.notAppearing++;
    groups.set(placeOf(p), g);
  }
  const appeared = rows.filter((p) => p.subjectStatus === "appeared").length;
  const notAppearing = rows.filter((p) => p.subjectStatus === "not_appearing").length;
  return (
    <section className="panel panel-pad song-section" aria-labelledby="song-performances">
      <h3 id="song-performances" className="column-title">
        披露 {rows.length} 回
        {song.subject && rows.length > 0 && (
          <span className="quiet">
            {song.subject.name}: 参加 {appeared}・不参加 {notAppearing}・未確認{" "}
            {rows.length - appeared - notAppearing}
          </span>
        )}
      </h3>
      {rows.length === 0 ? (
        <p className="quiet">セットリストに入っている公演・放送はまだありません。</p>
      ) : (
        <>
          <table className="song-stats">
            <thead>
              <tr>
                <th scope="col">歌った場</th>
                <th scope="col">披露</th>
                {song.subject && <th scope="col">参加</th>}
                {song.subject && <th scope="col">不参加</th>}
              </tr>
            </thead>
            <tbody>
              {[...groups].map(([place, g]) => (
                <tr key={place}>
                  <th scope="row">{place}</th>
                  <td>{g.total}</td>
                  {song.subject && <td>{g.appeared}</td>}
                  {song.subject && <td>{g.notAppearing}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="song-list song-history">
            {rows.map((p) => (
              <li key={p.itemId}>
                <span className="quiet">{p.startsOn ?? "日付不明"}</span>{" "}
                <Link
                  to={
                    p.parentId
                      ? `/events/${p.parentId}?schedule=${encodeURIComponent(p.eventId)}`
                      : `/events/${p.eventId}`
                  }
                >
                  {p.parentTitle ?? p.title}
                </Link>
                {p.part && <span className="quiet">（{p.part}）</span>}{" "}
                <span className="tag">{placeOf(p)}</span>
                {song.subject && (
                  <span className={`participation is-${p.subjectStatus ?? "unknown"}`}>
                    {STATUS_LABELS[p.subjectStatus ?? "unknown"]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function SongDetailView({ id }: { id: string }) {
  const { source } = useApp();
  const [song] = useLoad(() => source.getSong!(id), [source, id], [], `song:${id}`);
  if (song.status === "loading") return <p className="quiet">読み込んでいます</p>;
  if (song.status === "error") {
    return (
      <p className="error" role="alert">
        楽曲を読めませんでした: {song.error.message}
      </p>
    );
  }
  const s = song.data;
  return (
    <article className="page">
      <header className="page-head">
        <h2 className="page-title">{s.name}</h2>
        {s.reading && <p className="page-sub">{s.reading}</p>}
      </header>
      <section className="panel panel-pad song-section" aria-labelledby="song-releases">
        <h3 id="song-releases" className="column-title">
          収録
        </h3>
        {s.releases.length === 0 ? (
          <p className="quiet">シングル・アルバムへの収録の記録はありません。</p>
        ) : (
          <ul className="song-list">
            {s.releases.map((r) => (
              <li key={r.id}>
                {RELEASE_LABELS[r.subtype] ?? r.subtype}「{r.name}」
                {r.position !== null && ` ${r.position} 曲目`}
                {r.isTitle && "（表題曲）"}
                {r.releasedOn && <span className="quiet"> {r.releasedOn}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Performances song={s} />
    </article>
  );
}

export function SongsPage() {
  const { source, viewer } = useApp();
  const { id } = useParams();
  const [list, reload] = useLoad<SongList | null>(
    () => (source.listSongs ? source.listSongs() : Promise.resolve(null)),
    [source],
    [],
    "songs",
  );
  if (!viewer.isMember) {
    return (
      <section className="page narrow">
        <h1 className="page-title">楽曲</h1>
        <p>楽曲の画面は、参加者として登録された人だけが使えます。</p>
      </section>
    );
  }
  const loose =
    list.status === "ready" && list.data ? list.data.songs.filter((s) => !s.inRelease) : [];
  return (
    <div className={`split ${id ? "has-detail" : ""}`}>
      <section className="split-list" aria-label="楽曲の一覧">
        <div className="page-head">
          <h1 className="page-title">楽曲</h1>
          <p className="page-sub">シングル・アルバムごとの収録曲</p>
        </div>
        {viewer.isAdmin && <SongImport onDone={reload} />}
        {list.status === "loading" && <p className="quiet">読み込んでいます</p>}
        {list.status === "error" && (
          <p className="error" role="alert">
            楽曲を読めませんでした: {list.error.message}
          </p>
        )}
        {list.status === "ready" && !list.data && (
          <p className="quiet">この版では楽曲リストを使えません。</p>
        )}
        {list.status === "ready" && list.data && list.data.releases.length === 0 && (
          <p className="empty">まだ楽曲リストがありません。</p>
        )}
        {list.status === "ready" && list.data && list.data.releases.length > 0 && (
          <ol className="panel song-releases">
            {list.data.releases.map((r) => (
              <ReleaseBlock
                key={r.id}
                release={r}
                counts={new Map(list.data!.songs.map((s) => [s.id, s]))}
                subject={list.data!.subject !== null}
              />
            ))}
          </ol>
        )}
        {loose.length > 0 && (
          <section className="panel panel-pad" aria-labelledby="songs-loose">
            <h2 id="songs-loose" className="column-title">
              収録の記録が無い曲
            </h2>
            <ul className="song-tracks">
              {loose.map((s) => (
                <li key={s.id}>
                  <NavLink to={`/songs/${s.id}`} className="song-track">
                    <span className="song-track-name">{s.name}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
      <section key={id ?? ""} className="split-detail" aria-label="楽曲">
        {id && source.getSong ? (
          <SongDetailView id={id} />
        ) : (
          <div className="split-empty">
            <Music size={20} aria-hidden="true" />
            <p>左の一覧から曲を選びます</p>
          </div>
        )}
      </section>
    </div>
  );
}
