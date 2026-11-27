// ダッシュボード（設計書 決定記録 0063）
//
// アーカイブに何が入っていて、どんな作業が残っているかを 1 画面で見渡す。作業者・運営者の最初の画面。
// - やること: 作業者・運営者だけ。件数と、開く先へのリンク（例は 5 件まで）
// - 入っているデータ・最近の動き: 全員

import type { ReactNode } from "react";
import { Link } from "react-router";
import { useApp } from "../context.tsx";
import { EVENT_KIND_SHORT, formatInstant, MEDIA_LABELS } from "../format.ts";
import type { Dashboard, DashboardEvent } from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { useLayout } from "./Layout.tsx";

const nf = new Intl.NumberFormat("ja-JP");

/** 出来事の表示の画面（日程は、まとまりの画面で開く。決定記録 0060） */
export function eventPath(e: Pick<DashboardEvent, "id" | "parentId">): string {
  return e.parentId ? `/events/${e.parentId}?schedule=${e.id}` : `/events/${e.id}`;
}

function eventLabel(e: DashboardEvent): string {
  const title = e.parentTitle ?? e.title ?? "（題名なし）";
  return [e.startsOn?.replaceAll("-", "/"), title].filter(Boolean).join(" ");
}

function day(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** やることの 1 枚 */
function Task({
  title,
  count,
  unit = "件",
  to,
  note,
  children,
}: {
  title: string;
  count: number;
  unit?: string;
  to?: string;
  note?: string | null;
  children?: ReactNode;
}) {
  const done = count === 0;
  // 開く先のある、残っている作業は、カード全体を押して開ける（「開く」の文字を狙わなくてよい）
  const whole = !done && to !== undefined && children === undefined;
  return (
    <li className={`dashboard-task ${done ? "is-done" : ""} ${whole ? "is-link" : ""}`}>
      <div className="dashboard-task-head">
        <span className="dashboard-task-title">{title}</span>
        <span className="dashboard-task-count" aria-label={`${title} ${count} ${unit}`}>
          {done ? "なし" : `${nf.format(count)} ${unit}`}
        </span>
      </div>
      {note && !done && <p className="quiet dashboard-task-note">{note}</p>}
      {!done && children}
      {!done && to && (
        <Link className="link-button dashboard-task-open" to={to}>
          開く
        </Link>
      )}
    </li>
  );
}

function EventExamples({ events, more }: { events: DashboardEvent[]; more: number }) {
  return (
    <ul className="dashboard-examples">
      {events.map((e) => (
        <li key={e.id}>
          <Link to={eventPath(e)}>{eventLabel(e)}</Link>
          {e.songs !== undefined && <span className="quiet"> {e.songs} 曲</span>}
        </li>
      ))}
      {more > 0 && <li className="quiet">ほか {nf.format(more)} 件</li>}
    </ul>
  );
}

function Tasks({ tasks }: { tasks: NonNullable<Dashboard["tasks"]> }) {
  const oldest = tasks.pendingOldest
    ? `いちばん古いもの: ${formatInstant(tasks.pendingOldest)}`
    : null;
  return (
    <section className="dashboard-section" aria-labelledby="dashboard-tasks">
      <h2 id="dashboard-tasks">やること</h2>
      <ul className="dashboard-tasks">
        <Task title="承認待ち" count={tasks.pending} to="/intake" note={oldest} />
        <Task title="振り分け待ち（ブログ）" count={tasks.triage.blog} to="/triage/blog" />
        <Task title="振り分け待ち（ニュース）" count={tasks.triage.news} to="/triage/news" />
        {tasks.setlistMissing && (
          <Task title="セットリストの無い公演" count={tasks.setlistMissing.count}>
            <EventExamples
              events={tasks.setlistMissing.events}
              more={tasks.setlistMissing.count - tasks.setlistMissing.events.length}
            />
          </Task>
        )}
        {tasks.unknownParticipation && (
          <Task title="曲ごとの参加が未確認" count={tasks.unknownParticipation.count} unit="曲">
            <EventExamples events={tasks.unknownParticipation.events} more={0} />
          </Task>
        )}
        <Task
          title="出演が予定のまま日付を過ぎた出来事"
          count={tasks.overdue.count}
          to="/participation"
        >
          <EventExamples
            events={tasks.overdue.events}
            more={tasks.overdue.count - tasks.overdue.events.length}
          />
        </Task>
        {tasks.participationMissing && (
          <Task
            title="本人の出演が付いていない出来事"
            count={tasks.participationMissing.count}
            to="/participation"
            note="出演の確認の画面で、押すだけで付けられます"
          >
            <EventExamples
              events={tasks.participationMissing.events}
              more={tasks.participationMissing.count - tasks.participationMissing.events.length}
            />
          </Task>
        )}
        <Task
          title="似た画像の確認"
          count={tasks.similarImages.count}
          unit="組"
          to="/duplicates"
          note={
            tasks.similarImages.unhashed > 0
              ? `見た目のハッシュを計算中の画像があと ${nf.format(tasks.similarImages.unhashed)} 枚あります`
              : null
          }
        />
        <Task
          title="原本の保存が漏れている素材"
          count={tasks.missingFiles.count}
          note="投稿の画面の「保存をやり直す」で直せます"
        >
          <ul className="dashboard-examples">
            {tasks.missingFiles.posts.map((p) => (
              <li key={p.id}>
                <Link to={`/posts/${p.id}`}>{p.title?.trim() || "（題名なし）"}</Link>
                <span className="quiet"> {p.files} 件</span>
              </li>
            ))}
          </ul>
        </Task>
      </ul>
    </section>
  );
}

function Data({ data }: { data: Dashboard["data"] }) {
  const posts = data.posts.reduce((n, p) => n + p.count, 0);
  const assets = data.assets.reduce((n, a) => n + a.count, 0);
  const events = data.events.reduce((n, e) => n + e.count, 0);
  const range =
    data.postsRange.oldest && data.postsRange.newest
      ? `${data.postsRange.oldest.replaceAll("-", "/")} 〜 ${data.postsRange.newest.replaceAll("-", "/")}`
      : null;
  return (
    <section className="dashboard-section" aria-labelledby="dashboard-data">
      <h2 id="dashboard-data">入っているデータ</h2>
      <dl className="dashboard-stats">
        <div>
          <dt>投稿</dt>
          <dd>{nf.format(posts)}</dd>
        </div>
        <div>
          <dt>素材</dt>
          <dd>{nf.format(assets)}</dd>
        </div>
        <div>
          <dt>出来事</dt>
          <dd>
            {nf.format(events)}
            {data.schedules > 0 && (
              <span className="quiet dashboard-stat-sub">日程 {nf.format(data.schedules)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>人物</dt>
          <dd>{nf.format(data.people)}</dd>
        </div>
        <div>
          <dt>楽曲</dt>
          <dd>{nf.format(data.songs)}</dd>
        </div>
      </dl>
      {range && <p className="quiet dashboard-range">投稿の期間: {range}</p>}
      <div className="dashboard-breakdowns">
        <Breakdown
          title="情報源ごとの投稿"
          rows={data.posts.map((p) => ({ key: p.channelId, label: p.name, count: p.count }))}
        />
        <Breakdown
          title="種類ごとの素材"
          rows={data.assets.map((a) => ({
            key: a.mediaType,
            label: MEDIA_LABELS[a.mediaType] ?? a.mediaType,
            count: a.count,
          }))}
        />
        <Breakdown
          title="種類ごとの出来事"
          rows={data.events.map((e) => ({
            key: e.kind,
            label: EVENT_KIND_SHORT[e.kind] ?? e.kind,
            count: e.count,
          }))}
        />
      </div>
    </section>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; count: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <figure className="dashboard-breakdown">
      <figcaption>{title}</figcaption>
      {rows.length === 0 ? (
        <p className="quiet">まだありません</p>
      ) : (
        <table>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td className="dashboard-bar-cell">
                  <span className="dashboard-bar" style={{ width: `${(r.count / max) * 100}%` }} />
                </td>
                <td className="dashboard-num">{nf.format(r.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}

function Recent({ recent }: { recent: Dashboard["recent"] }) {
  const max = Math.max(1, ...recent.days.map((d) => d.approved + d.rejected + d.discarded));
  const total = recent.days.reduce((n, d) => n + d.approved, 0);
  return (
    <section className="dashboard-section" aria-labelledby="dashboard-recent">
      <h2 id="dashboard-recent">最近の動き</h2>
      <figure className="dashboard-week">
        <figcaption>この 7 日間に承認した投稿: {nf.format(total)} 件</figcaption>
        <table>
          <thead>
            <tr>
              <th scope="col">日付</th>
              <th scope="col">承認</th>
              <th scope="col">却下</th>
              <th scope="col">言及なし</th>
              <th scope="col" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {recent.days.map((d) => (
              <tr key={d.date}>
                <th scope="row">{day(d.date)}</th>
                <td className="dashboard-num">{d.approved}</td>
                <td className="dashboard-num">{d.rejected}</td>
                <td className="dashboard-num">{d.discarded}</td>
                <td className="dashboard-bar-cell" aria-hidden="true">
                  <span
                    className="dashboard-bar is-approved"
                    style={{ width: `${(d.approved / max) * 100}%` }}
                  />
                  <span
                    className="dashboard-bar is-other"
                    style={{ width: `${((d.rejected + d.discarded) / max) * 100}%` }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>
      {recent.approved.length > 0 && (
        <>
          <h3 className="dashboard-sub">直近に承認した投稿</h3>
          <ul className="dashboard-examples">
            {recent.approved.map((a, k) => (
              <li key={a.postId ?? k}>
                <span className="quiet">{formatInstant(a.reviewedAt)} </span>
                {a.postId ? (
                  <Link to={`/posts/${a.postId}`}>{a.title?.trim() || "（題名なし）"}</Link>
                ) : (
                  (a.title?.trim() ?? "（題名なし）")
                )}
                <span className="quiet"> {a.channel}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function DashboardPage() {
  const { source } = useApp();
  const layout = useLayout();
  const [loaded] = useLoad(
    () => (source.getDashboard ? source.getDashboard() : Promise.resolve(null)),
    [source],
    // 承認などで変わったときは、今の中身を見せたまま裏で読み直す
    [layout.version],
    "dashboard",
  );
  return (
    <section className="page wide dashboard">
      <header className="page-head">
        <h1 className="page-title">ダッシュボード</h1>
        <p className="page-sub">入っているデータと、残っている作業の総覧</p>
      </header>
      {loaded.status === "loading" && <p className="quiet">読み込んでいます</p>}
      {loaded.status === "error" && (
        <p className="error" role="alert">
          読み込めませんでした: {loaded.error.message}
        </p>
      )}
      {loaded.status === "ready" && loaded.data === null && (
        <p className="quiet">この環境ではダッシュボードを使えません。</p>
      )}
      {loaded.status === "ready" && loaded.data && (
        <>
          {loaded.data.tasks && <Tasks tasks={loaded.data.tasks} />}
          <Data data={loaded.data.data} />
          <Recent recent={loaded.data.recent} />
        </>
      )}
    </section>
  );
}
