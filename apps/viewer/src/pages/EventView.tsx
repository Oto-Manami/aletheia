// 出来事の表示の画面。開いたときは中身を見せ、直すときは「編集」から編集の画面（EventEditPage）に移る
//
// 並び: 題名と日付 → 紐付いた画像（アセットの画面と同じ形のタイル。押すと原本を開く） → 出典の記事 → 日程

import { ChevronLeft, ExternalLink, Pencil } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { type GalleryImage, GalleryGrid, ImageViewer } from "../components/MaterialGallery.tsx";
import { useApp } from "../context.tsx";
import {
  EVENT_KIND_LABELS,
  eventDateLabel,
  formatPublished,
  jstTime,
  PARTICIPANT_STATUS_LABELS,
} from "../format.ts";
import type { EventDetail } from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { listSearch } from "./Events.tsx";
import { useLayout } from "./Layout.tsx";

/** 日付と時刻（時刻が分かれば付ける） */
function whenOf(d: {
  startsOn: string | null;
  endsOn: string | null;
  datePrecision: string | null;
  startsAt: string | null;
  endsAt?: string | null;
}): string {
  const date = eventDateLabel(d.startsOn, d.endsOn, d.datePrecision);
  const start = jstTime(d.startsAt);
  const end = jstTime(d.endsAt ?? null);
  if (!start) return date;
  return `${date} ${start}${end ? `〜${end}` : ""}`;
}

export function EventViewPage() {
  const { id = "" } = useParams();
  const { source } = useApp();
  const layout = useLayout();
  // 編集の画面で直したり素材を紐付けたりしたら、裏で読み直す
  const [loaded] = useLoad(() => source.getEvent(id), [source, id], [layout.version]);
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice ?? null;

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
      <EventView key={id} detail={loaded.data} />
    </>
  );
}

function EventView({ detail }: { detail: EventDetail }) {
  const { viewer } = useApp();
  const [params] = useSearchParams();
  const [viewing, setViewing] = useState<number | null>(null);
  const search = listSearch(params);

  const gallery: GalleryImage[] = detail.materials.flatMap((m) => {
    const title = m.title?.trim() || "（題名なし）";
    const caption = [m.channelName, formatPublished(m)].filter(Boolean).join(" ・ ");
    return m.images.map((image) => ({ ...image, postTitle: title, caption }));
  });
  // 素材として紐付いていない出典の URL（素材の URL と同じものは、出典の記事の方に出す）
  const materialUrls = new Set(detail.materials.flatMap((m) => (m.url ? [m.url] : [])));
  const otherSources = detail.sources.filter((s) => !materialUrls.has(s.url));
  const isSchedule = Boolean(detail.parentId);

  return (
    <article className="panel panel-pad event-view" aria-labelledby="event-view-title">
      <header className="event-view-head">
        <div className="event-view-nav">
          <Link className="back-link" to={{ pathname: "/events", search }}>
            <ChevronLeft size={16} aria-hidden="true" />
            一覧に戻る
          </Link>
          {viewer.canWork && (
            <Link className="button" to={{ pathname: `/events/${detail.id}/edit`, search }}>
              <Pencil size={14} aria-hidden="true" />
              編集
            </Link>
          )}
        </div>
        {isSchedule && (
          <Link
            className="event-schedule-of"
            to={{ pathname: `/events/${detail.parentId}`, search }}
          >
            「{detail.parentTitle ?? "（題名なし）"}」{detail.parentKind ? "の日程" : ""}
          </Link>
        )}
        <h2 id="event-view-title" className="event-view-title">
          {detail.title || "（題名なし）"}
        </h2>
        <p className="event-view-when">{whenOf(detail)}</p>
        <p className="event-view-meta">
          <span className="tag">{EVENT_KIND_LABELS[detail.kind] ?? detail.kind}</span>
          {detail.part && <span>{detail.part}</span>}
          {detail.workName && <span>{detail.workName}</span>}
          {detail.venueName && <span>{detail.venueName}</span>}
          {detail.classification === "private" && <span className="tag tag-private">非公開</span>}
        </p>
      </header>

      <section className="event-view-section" aria-labelledby="event-view-images">
        <h3 id="event-view-images">画像（{gallery.length} 枚）</h3>
        {gallery.length === 0 ? (
          <p className="quiet">紐付いている素材に画像はありません。</p>
        ) : (
          <GalleryGrid images={gallery} onOpen={setViewing} />
        )}
      </section>

      <section className="event-view-section" aria-labelledby="event-view-sources">
        <h3 id="event-view-sources">
          出典の記事（{detail.materials.length + otherSources.length} 件）
        </h3>
        {detail.materials.length === 0 && otherSources.length === 0 ? (
          <p className="quiet">
            出典はまだありません。
            {viewer.canWork && "「編集」から出典の URL を足すか、素材を紐付けます。"}
          </p>
        ) : (
          <ul className="event-sources">
            {detail.materials.map((m, i) => {
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
                  {m.images.length > 0 && <span className="quiet">画像 {m.images.length}</span>}
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
            {otherSources.map((s) => (
              <li key={s.url}>
                <span className="event-material-channel">出典の URL</span>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="event-material-title ext-link"
                >
                  {s.url}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.children.length > 0 && (
        <section className="event-view-section" aria-labelledby="event-view-children">
          <h3 id="event-view-children">日程（{detail.children.length} 件）</h3>
          <ul className="event-sources">
            {detail.children.map((c) => (
              <li key={c.id}>
                <span className="quiet event-material-date">{whenOf(c)}</span>
                <Link to={{ pathname: `/events/${c.id}`, search }} className="event-material-title">
                  {c.title}
                  {c.part ? `（${c.part}）` : ""}
                </Link>
                {c.venueName && <span className="quiet">{c.venueName}</span>}
                {c.subjectStatus && (
                  <span className={`event-status status-${c.subjectStatus}`}>
                    {PARTICIPANT_STATUS_LABELS[c.subjectStatus]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {viewing !== null && (
        <ImageViewer
          images={gallery}
          index={viewing}
          onMove={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
    </article>
  );
}
