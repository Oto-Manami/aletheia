// 出来事の記事（設計書 決定記録 0058）
//
// まとまり（ライブ・ミーグリなど）に、運営が書く記事を 1 つ置く。参加者だけが読む解釈の層で、事実とは分けて見せる。
// - ミーグリ: 日ごと（同じ日の部はまとめる）に、服装（メモと写真）・内容・同じ日の配信
// - ライブ: セットリスト（まとまりと日程ごと。文字で書いて入れる）
// - どの種類も: 自由記述

import { Pencil, Plus, X } from "lucide-react";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import { useApp } from "../context.tsx";
import { formatInstant } from "../format.ts";
import { formatSetlist, parseSetlist, songIndex, unmatchedSongs } from "../source/setlist.ts";
import type {
  ArticleDay,
  ArticleSetlist,
  EventArticleView,
  EventDetail,
  SongSummary,
} from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { type GalleryImage, MaterialThumbs, PickThumbs } from "./MaterialGallery.tsx";

/** 型の欄を持つ種類 */
const DAY_KINDS = new Set(["meet_greet"]);
const SETLIST_KINDS = new Set(["live"]);

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 文章を段落に分け、URL をリンクにする（HTML としては読まない） */
export function RichText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className="article-text">
          {p.split(/(https?:\/\/[^\s<>"）)]+)/g).map((part, j) =>
            /^https?:\/\//.test(part) ? (
              <a key={j} href={part} target="_blank" rel="noreferrer noopener">
                {part}
              </a>
            ) : (
              <Fragment key={j}>{part}</Fragment>
            ),
          )}
        </p>
      ))}
    </>
  );
}

/** 日程の日付と、記事に書いた日を合わせた、日ごとの欄（同じ日の部はまとめる） */
export function articleDays(detail: EventDetail, written: readonly ArticleDay[]): ArticleDay[] {
  const dates = new Set([
    ...detail.children.flatMap((c) => (c.startsOn ? [c.startsOn] : [])),
    ...written.map((d) => d.date),
  ]);
  return [...dates].sort().map(
    (date) =>
      written.find((d) => d.date === date) ?? {
        date,
        outfitNote: "",
        outfitAssets: [],
        content: "",
        streams: [],
      },
  );
}

function partsOf(detail: EventDetail, date: string): string {
  return detail.children
    .filter((c) => c.startsOn === date && c.part)
    .map((c) => c.part)
    .join("・");
}

function isEmptyDay(d: ArticleDay): boolean {
  return !d.outfitNote && d.outfitAssets.length === 0 && !d.content && d.streams.length === 0;
}

function DayView({
  day,
  parts,
  gallery,
  onOpenImage,
}: {
  day: ArticleDay;
  parts: string;
  gallery: GalleryImage[];
  onOpenImage: (index: number) => void;
}) {
  const photos = gallery.filter((g) => day.outfitAssets.includes(g.assetId));
  return (
    <section className="article-day">
      <h4 className="article-day-date">
        {day.date}
        {parts && <span className="quiet">（{parts}）</span>}
      </h4>
      {isEmptyDay(day) ? (
        <p className="quiet">まだ書いていません。</p>
      ) : (
        <dl className="article-fields">
          {(day.outfitNote || photos.length > 0) && (
            <>
              <dt>服装</dt>
              <dd>
                {day.outfitNote && <RichText text={day.outfitNote} />}
                {photos.length > 0 && (
                  <MaterialThumbs
                    images={photos}
                    first={0}
                    onOpen={(i) => onOpenImage(gallery.indexOf(photos[i]!))}
                  />
                )}
              </dd>
            </>
          )}
          {day.content && (
            <>
              <dt>内容</dt>
              <dd>
                <RichText text={day.content} />
              </dd>
            </>
          )}
          {day.streams.length > 0 && (
            <>
              <dt>同じ日の配信</dt>
              <dd>
                <ul className="article-streams">
                  {day.streams.map((s, i) => (
                    <li key={i}>
                      <a href={s.url} target="_blank" rel="noreferrer noopener">
                        {s.title || s.url}
                      </a>
                      {s.note && <RichText text={s.note} />}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}

function DayEditor({
  day,
  parts,
  gallery,
  onChange,
}: {
  day: ArticleDay;
  parts: string;
  gallery: GalleryImage[];
  onChange: (d: ArticleDay) => void;
}) {
  const id = `day-${day.date}`;
  return (
    <fieldset className="article-day article-day-edit">
      <legend className="article-day-date">
        {day.date}
        {parts && <span className="quiet">（{parts}）</span>}
      </legend>
      <label htmlFor={`${id}-outfit`}>服装</label>
      <textarea
        id={`${id}-outfit`}
        rows={2}
        value={day.outfitNote}
        onChange={(e) => onChange({ ...day, outfitNote: e.target.value })}
      />
      {gallery.length > 0 ? (
        <>
          <p className="field-hint">
            服装の分かる写真を押して選びます（出来事に紐付いた画像から）。
          </p>
          <PickThumbs
            images={gallery}
            selected={day.outfitAssets}
            label={`${day.date} の服装の写真`}
            onToggle={(assetId) =>
              onChange({
                ...day,
                outfitAssets: day.outfitAssets.includes(assetId)
                  ? day.outfitAssets.filter((a) => a !== assetId)
                  : [...day.outfitAssets, assetId],
              })
            }
          />
        </>
      ) : (
        <p className="field-hint">
          服装の写真は、出来事に紐付いた投稿の画像から選びます（まだ紐付いた画像がありません）。
        </p>
      )}
      <label htmlFor={`${id}-content`}>内容</label>
      <textarea
        id={`${id}-content`}
        rows={4}
        value={day.content}
        onChange={(e) => onChange({ ...day, content: e.target.value })}
      />
      <p className="article-label">同じ日の配信</p>
      {day.streams.map((s, i) => {
        const set = (next: Partial<ArticleDay["streams"][number]>) =>
          onChange({
            ...day,
            streams: day.streams.map((x, j) => (j === i ? { ...x, ...next } : x)),
          });
        return (
          <div key={i} className="article-stream-edit">
            <input
              type="url"
              placeholder="https://"
              aria-label={`配信 ${i + 1} の URL`}
              value={s.url}
              onChange={(e) => set({ url: e.target.value })}
            />
            <input
              placeholder="題名"
              aria-label={`配信 ${i + 1} の題名`}
              value={s.title}
              onChange={(e) => set({ title: e.target.value })}
            />
            <textarea
              rows={2}
              placeholder="内容のメモ"
              aria-label={`配信 ${i + 1} の内容`}
              value={s.note}
              onChange={(e) => set({ note: e.target.value })}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={`配信 ${i + 1} を外す`}
              onClick={() => onChange({ ...day, streams: day.streams.filter((_, j) => j !== i) })}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="link-button"
        onClick={() =>
          onChange({ ...day, streams: [...day.streams, { url: "", title: "", note: "" }] })
        }
      >
        <Plus size={14} aria-hidden="true" />
        配信を足す
      </button>
    </fieldset>
  );
}

function setlistLabel(s: ArticleSetlist): string {
  if (!s.isSchedule) return "全公演で共通";
  return [s.startsOn, s.part].filter(Boolean).join(" ") || (s.title ?? "日程");
}

function SetlistBlock({
  setlist,
  songs,
  canWork,
  onSaved,
}: {
  setlist: ArticleSetlist;
  songs: readonly SongSummary[] | null;
  canWork: boolean;
  onSaved: () => void;
}) {
  const { source } = useApp();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const index = useMemo(() => songIndex(songs ?? []), [songs]);
  const parsed = text === null ? null : parseSetlist(text, index, setlist.items);
  const missing = parsed ? unmatchedSongs(parsed) : [];
  let n = 0;
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
  return (
    <section className="article-setlist">
      <h4 className="article-day-date">{setlistLabel(setlist)}</h4>
      {text === null ? (
        setlist.items.length === 0 ? (
          <p className="quiet">セットリストはまだありません。</p>
        ) : (
          <ol className="setlist">
            {setlist.items.map((i) => {
              const name = i.workName ?? i.title ?? "";
              if (i.itemType === "section") {
                return (
                  <li key={i.id} className="setlist-section">
                    {name}
                  </li>
                );
              }
              if (i.itemType !== "song") {
                return (
                  <li key={i.id} className="setlist-other quiet">
                    {name}
                  </li>
                );
              }
              n++;
              return (
                <li key={i.id} className="setlist-song">
                  <span className="setlist-no">M{n}</span>
                  <span>{name}</span>
                  {!i.workId && <span className="tag">楽曲リストに無い曲</span>}
                  {i.note && <span className="quiet">{i.note}</span>}
                </li>
              );
            })}
          </ol>
        )
      ) : (
        <div className="setlist-edit">
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
            {error && (
              <p className="error" role="alert">
                保存できませんでした: {error}
              </p>
            )}
          </div>
        </div>
      )}
      {canWork && text === null && source.saveEventItems && (
        <button
          type="button"
          className="link-button"
          onClick={() => setText(formatSetlist(setlist.items))}
        >
          <Pencil size={14} aria-hidden="true" />
          文字で書く
        </button>
      )}
    </section>
  );
}

function Loaded({
  detail,
  view,
  songs,
  gallery,
  onOpenImage,
  reload,
}: {
  detail: EventDetail;
  view: EventArticleView;
  songs: readonly SongSummary[] | null;
  gallery: GalleryImage[];
  onOpenImage: (index: number) => void;
  reload: () => void;
}) {
  const { source, viewer } = useApp();
  const article = view.article;
  const days = articleDays(detail, article?.days ?? []);
  const [draft, setDraft] = useState<{ body: string; days: ArticleDay[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const hasDays = DAY_KINDS.has(detail.kind);
  const hasSetlist = SETLIST_KINDS.has(detail.kind);
  const canEdit = viewer.canWork && !!source.saveEventArticle;

  const save = async () => {
    if (!draft || !source.saveEventArticle) return;
    setSaving(true);
    setError(null);
    try {
      await source.saveEventArticle(detail.id, {
        body: draft.body,
        // 何も書いていない日は残さない
        days: draft.days
          .map((d) => ({ ...d, streams: d.streams.filter((s) => s.url.trim()) }))
          .filter((d) => !isEmptyDay(d)),
      });
      setDraft(null);
      reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  };

  let content: ReactNode;
  if (draft) {
    content = (
      <div className="article-edit">
        {hasDays &&
          draft.days.map((d, i) => (
            <DayEditor
              key={d.date}
              day={d}
              parts={partsOf(detail, d.date)}
              gallery={gallery}
              onChange={(next) =>
                setDraft({ ...draft, days: draft.days.map((x, j) => (j === i ? next : x)) })
              }
            />
          ))}
        <label htmlFor="article-body" className="article-label">
          自由記述
        </label>
        <textarea
          id="article-body"
          rows={8}
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        />
        <div className="actions">
          <button
            type="button"
            className="button primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "保存しています" : "保存"}
          </button>
          <button type="button" className="button" onClick={() => setDraft(null)}>
            やめる
          </button>
          {error && (
            <p className="error" role="alert">
              保存できませんでした: {error}
            </p>
          )}
        </div>
      </div>
    );
  } else {
    content = (
      <>
        {hasDays &&
          (days.length === 0 ? (
            <p className="quiet">日程を足すと、日ごとに服装・内容・同じ日の配信を書けます。</p>
          ) : (
            days.map((d) => (
              <DayView
                key={d.date}
                day={d}
                parts={partsOf(detail, d.date)}
                gallery={gallery}
                onOpenImage={onOpenImage}
              />
            ))
          ))}
        {article?.body ? (
          <div className="article-body">
            {(hasDays || hasSetlist) && <h4 className="article-day-date">自由記述</h4>}
            <RichText text={article.body} />
          </div>
        ) : (
          !hasDays && <p className="quiet">まだ書いていません。</p>
        )}
      </>
    );
  }

  return (
    <section className="event-view-section event-article" aria-labelledby="event-article-title">
      <div className="event-article-head">
        <h3 id="event-article-title">
          記事 <span className="tag">運営のまとめ・参加者だけが読む</span>
        </h3>
        {canEdit && !draft && (
          <button
            type="button"
            className="button"
            onClick={() => setDraft({ body: article?.body ?? "", days })}
          >
            <Pencil size={14} aria-hidden="true" />
            {article ? "記事を直す" : "記事を書く"}
          </button>
        )}
      </div>
      {article?.updatedAt && (
        <p className="quiet event-article-meta">
          {formatInstant(article.updatedAt)} 更新
          {article.authorName && `・最初に書いた人 ${article.authorName}`}
        </p>
      )}
      {hasSetlist && (
        <div className="article-setlists">
          <h4 className="article-group-title">セットリスト</h4>
          {view.setlists.map((s) => (
            <SetlistBlock
              key={s.eventId}
              setlist={s}
              songs={songs}
              canWork={viewer.canWork}
              onSaved={reload}
            />
          ))}
        </div>
      )}
      {content}
    </section>
  );
}

/** 出来事の表示の画面に置く記事（まとまりだけ。日程には置かない） */
export function EventArticleSection({
  detail,
  gallery,
  onOpenImage,
}: {
  detail: EventDetail;
  gallery: GalleryImage[];
  onOpenImage: (index: number) => void;
}) {
  const { source } = useApp();
  const [view, reload] = useLoad(
    () =>
      source.getEventArticle
        ? source.getEventArticle(detail.id)
        : Promise.resolve<EventArticleView | null>(null),
    [source, detail.id],
  );
  const [songs] = useLoad(
    () =>
      source.listSongs && SETLIST_KINDS.has(detail.kind)
        ? source.listSongs().then((l) => l.songs)
        : Promise.resolve<SongSummary[] | null>(null),
    [source, detail.kind],
  );
  if (detail.parentId || !source.getEventArticle) return null;
  if (view.status === "loading") return <p className="quiet">記事を読み込んでいます</p>;
  if (view.status === "error") {
    return (
      <p className="error" role="alert">
        記事を読めませんでした: {view.error.message}
      </p>
    );
  }
  if (!view.data) return null;
  return (
    <Loaded
      detail={detail}
      view={view.data}
      songs={songs.status === "ready" ? songs.data : null}
      gallery={gallery}
      onOpenImage={onOpenImage}
      reload={reload}
    />
  );
}
