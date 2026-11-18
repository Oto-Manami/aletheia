// 作品の一覧と作品の画面（設計書 決定記録 0065）
//
// 番組・雑誌・連載・企画（シリーズ）など、作品にまとめて繰り返す仕事を見渡す。
// - 一覧（/works）: 種類と名前で絞る。作業者・運営者は作品を作れる
// - 作品の画面（/works/:id）: その作品の回・号の一覧と、回・号や作品に紐付いた素材の画像
// - 楽曲・シングル・アルバム・MV は楽曲の画面で扱う（決定記録 0066）

import { ChevronLeft, Plus } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { ClassificationChoice } from "../components/EntityPicker.tsx";
import { type GalleryImage, GalleryGrid, ImageViewer } from "../components/MaterialGallery.tsx";
import { useApp } from "../context.tsx";
import {
  ENTITY_SUBTYPE_LABELS,
  EVENT_KIND_SHORT,
  eventDateLabel,
  formatPublished,
  PARTICIPANT_STATUS_LABELS,
} from "../format.ts";
import type { Classification, WorkView } from "../source/types.ts";
import { useLoad } from "../use-load.ts";

/** 楽曲の画面で扱う種類（作品の一覧には出さず、作らない。決定記録 0066） */
const MUSIC_SUBTYPES = new Set(["song", "single", "album", "music_video"]);
const WORK_LABELS = Object.fromEntries(
  Object.entries(ENTITY_SUBTYPE_LABELS["work"] ?? {}).filter(([k]) => !MUSIC_SUBTYPES.has(k)),
);
const nf = new Intl.NumberFormat("ja-JP");

/** 一覧の種類の絞り込み（よく使うものを先に） */
const SUBTYPE_ORDER = [
  "tv_program",
  "radio_program",
  "web_program",
  "magazine",
  "series",
  "cm",
  "drama",
  "film",
  "stage",
  "photobook",
  "book",
];

function subtypeLabel(subtype: string | null): string {
  return (subtype && (ENTITY_SUBTYPE_LABELS["work"] ?? {})[subtype]) || "作品";
}

/** 出来事の表示の画面（日程は、まとまりの画面で開く。決定記録 0060） */
function eventPath(e: { id: string; parentId: string | null }): string {
  return e.parentId ? `/events/${e.parentId}?schedule=${e.id}` : `/events/${e.id}`;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 作品を作る（作業者・運営者） */
function CreateWork({ subtype }: { subtype: string }) {
  const { source } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState(subtype || "tv_program");
  const [classification, setClassification] = useState<Classification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className="button" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden="true" />
        作品を作る
      </button>
    );
  }
  const create = async () => {
    if (!name.trim() || !classification) return;
    setBusy(true);
    setError(null);
    try {
      const made = await source.createEntity({
        type: "work",
        subtype: kind,
        name: name.trim(),
        classification,
      });
      // 同じ名前の作品があれば、それを開く
      void navigate(`/works/${made.id}`);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };
  return (
    <div className="panel panel-pad work-create" role="group" aria-label="作品を作る">
      <div className="field-row">
        <div className="field">
          <label htmlFor="work-create-name">名前</label>
          <input
            id="work-create-name"
            value={name}
            placeholder="日向坂で会いましょう"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="work-create-kind">種類</label>
          <select id="work-create-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(WORK_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <ClassificationChoice
          name="work-create-classification"
          value={classification}
          onChange={setClassification}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          作れませんでした: {error}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          className="button primary"
          disabled={busy || !name.trim() || !classification}
          onClick={() => void create()}
        >
          作る
        </button>
        <button type="button" className="button" onClick={() => setOpen(false)}>
          やめる
        </button>
      </div>
    </div>
  );
}

function WorkList() {
  const { source, viewer } = useApp();
  const [params, setParams] = useSearchParams();
  const subtype = params.get("type") ?? "";
  const query = params.get("q") ?? "";
  const [typed, setTyped] = useState(query);
  const [list] = useLoad(
    () =>
      source.listWorks
        ? source.listWorks({ ...(subtype ? { subtype } : {}), ...(query ? { query } : {}) })
        : Promise.resolve(null),
    [source, subtype, query],
    [],
    `works:${subtype}:${query}`,
  );
  const set = (patch: { type?: string; q?: string }) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next);
  };
  const order = [
    ...SUBTYPE_ORDER.filter((k) => WORK_LABELS[k]),
    ...Object.keys(WORK_LABELS).filter((k) => !SUBTYPE_ORDER.includes(k)),
  ];

  return (
    <section className="page">
      <div className="page-head">
        <h1 className="page-title">作品</h1>
        <p className="page-sub">
          番組・雑誌・連載などの作品ごとに、回・号と素材をまとめて見られます。
        </p>
      </div>
      <div className="triage-toolbar">
        <div className="triage-views">
          <span className="triage-select">
            <label htmlFor="works-type">種類</label>
            <select id="works-type" value={subtype} onChange={(e) => set({ type: e.target.value })}>
              <option value="">すべての種類</option>
              {order.map((k) => (
                <option key={k} value={k}>
                  {WORK_LABELS[k]}
                </option>
              ))}
            </select>
          </span>
          <form
            className="triage-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              set({ q: typed.trim() });
            }}
          >
            <label htmlFor="works-q" className="visually-hidden">
              作品の名前で探す
            </label>
            <input
              id="works-q"
              type="search"
              value={typed}
              placeholder="名前で探す"
              onChange={(e) => setTyped(e.target.value)}
            />
          </form>
        </div>
        {viewer.canWork && <CreateWork subtype={subtype} />}
      </div>
      {list.status === "loading" && <p className="quiet">読み込んでいます</p>}
      {list.status === "error" && (
        <p className="error" role="alert">
          読み込めませんでした: {list.error.message}
        </p>
      )}
      {list.status === "ready" && list.data === null && (
        <p className="quiet">この環境では作品の一覧を使えません。</p>
      )}
      {list.status === "ready" && list.data && list.data.length === 0 && (
        <p className="quiet">当てはまる作品はありません。</p>
      )}
      {list.status === "ready" && list.data && list.data.length > 0 && (
        <table className="works-table">
          <thead>
            <tr>
              <th scope="col">名前</th>
              <th scope="col">種類</th>
              <th scope="col" className="dashboard-num">
                回・号
              </th>
              <th scope="col" className="dashboard-num">
                素材
              </th>
              <th scope="col">いちばん新しい回・号</th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((w) => (
              <tr key={w.id}>
                <th scope="row">
                  <Link to={`/works/${w.id}`}>{w.name}</Link>
                </th>
                <td className="quiet">{subtypeLabel(w.subtype)}</td>
                <td className="dashboard-num">{nf.format(w.events)}</td>
                <td className="dashboard-num">{nf.format(w.materials)}</td>
                <td className="quiet">{w.latest ? eventDateLabel(w.latest, null, "day") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** 回・号の一覧（多いときは先頭だけを出し、押すと全部） */
function WorkEvents({ view }: { view: WorkView }) {
  const [all, setAll] = useState(false);
  const LIMIT = 20;
  const shown = all ? view.events : view.events.slice(0, LIMIT);
  return (
    <section className="event-view-section" aria-labelledby="work-events">
      <h2 id="work-events">回・号（{nf.format(view.events.length)} 件）</h2>
      {view.events.length === 0 ? (
        <p className="quiet">
          この作品を指す回・号はまだありません。出来事の画面で、作品にこの作品を選んで作ります。
        </p>
      ) : (
        <ul className="work-events">
          {shown.map((e) => (
            <li key={e.id}>
              <span className="quiet event-material-date">
                {eventDateLabel(e.startsOn, null, e.datePrecision)}
              </span>
              <Link to={eventPath(e)}>
                {e.title ?? "（題名なし）"}
                {e.episodeNumber !== null && ` #${e.episodeNumber}`}
              </Link>
              <span className="quiet">{EVENT_KIND_SHORT[e.kind] ?? e.kind}</span>
              {e.materials > 0 && <span className="quiet">素材 {e.materials}</span>}
              {e.subjectStatus && (
                <span className={`event-status status-${e.subjectStatus}`}>
                  {PARTICIPANT_STATUS_LABELS[e.subjectStatus] ?? e.subjectStatus}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!all && view.events.length > LIMIT && (
        <button type="button" className="link-button" onClick={() => setAll(true)}>
          すべて表示（ほか {nf.format(view.events.length - LIMIT)} 件）
        </button>
      )}
    </section>
  );
}

function WorkImages({ view }: { view: WorkView }) {
  const [onlySubject, setOnlySubject] = useState(view.subject !== null);
  const [viewing, setViewing] = useState<number | null>(null);
  const picked = onlySubject ? view.images.filter((i) => i.subjectAppears) : view.images;
  const gallery: GalleryImage[] = picked.map((i) => {
    const where = i.eventId
      ? [i.eventStartsOn?.replaceAll("-", "/"), i.eventTitle].filter(Boolean).join(" ")
      : "作品に直接";
    return {
      assetId: i.assetId,
      fileAssetId: i.fileAssetId,
      postTitle: i.postTitle?.trim() || "（題名なし）",
      caption: [where, i.channelName, formatPublished(i)].filter(Boolean).join(" ・ "),
    };
  });
  return (
    <section className="event-view-section" aria-labelledby="work-images">
      <h2 id="work-images">素材（{nf.format(picked.length)} 枚）</h2>
      {view.subject && (
        <label className="work-only-subject">
          <input
            type="checkbox"
            checked={onlySubject}
            onChange={(e) => {
              setOnlySubject(e.target.checked);
              setViewing(null);
            }}
          />
          {view.subject.name} が写っているものだけ
        </label>
      )}
      {picked.length === 0 ? (
        <p className="quiet">
          {onlySubject
            ? `${view.subject?.name ?? ""} が写っている画像はまだありません。`
            : "画像はまだありません。"}
        </p>
      ) : (
        <GalleryGrid images={gallery} onOpen={setViewing} />
      )}
      {view.moreImages && (
        <p className="quiet">画像が多いため、新しいものから一部だけを出しています。</p>
      )}
      {viewing !== null && (
        <ImageViewer
          images={gallery}
          index={viewing}
          onMove={setViewing}
          onClose={() => setViewing(null)}
          aside={(_image, index) => {
            const i = picked[index];
            if (!i) return null;
            return (
              <section className="asset-info-post">
                <h4>投稿</h4>
                <Link to={`/posts/${i.postId}`}>{i.postTitle?.trim() || "（題名なし）"}</Link>
                <span className="quiet">
                  {i.channelName}
                  {formatPublished(i) && ` ・ ${formatPublished(i)}`}
                </span>
                {i.eventId && (
                  <Link to={`/events/${i.eventId}`} className="tag">
                    {i.eventTitle ?? "（題名なし）"}
                  </Link>
                )}
              </section>
            );
          }}
        />
      )}
    </section>
  );
}

function WorkPage({ id }: { id: string }) {
  const { source } = useApp();
  const [loaded] = useLoad(
    () => (source.getWork ? source.getWork(id) : Promise.resolve(null)),
    [source, id],
    [],
    `work:${id}`,
  );
  return (
    <section className="page wide">
      <Link className="back-link" to="/works">
        <ChevronLeft size={16} aria-hidden="true" />
        作品の一覧
      </Link>
      {loaded.status === "loading" && <p className="quiet">読み込んでいます</p>}
      {loaded.status === "error" && (
        <p className="error" role="alert">
          読み込めませんでした: {loaded.error.message}
        </p>
      )}
      {loaded.status === "ready" && loaded.data === null && (
        <p className="quiet">この環境では作品の画面を使えません。</p>
      )}
      {loaded.status === "ready" &&
        loaded.data &&
        MUSIC_SUBTYPES.has(loaded.data.work.subtype ?? "") && (
          // 楽曲は楽曲の画面で見る（決定記録 0066）
          <Navigate
            to={loaded.data.work.subtype === "song" ? `/songs/${loaded.data.work.id}` : "/songs"}
            replace
          />
        )}
      {loaded.status === "ready" &&
        loaded.data &&
        !MUSIC_SUBTYPES.has(loaded.data.work.subtype ?? "") && (
          <>
            <div className="page-head">
              <h1 className="page-title">{loaded.data.work.name}</h1>
              <p className="page-sub">{subtypeLabel(loaded.data.work.subtype)}</p>
            </div>
            <WorkEvents view={loaded.data} />
            <WorkImages view={loaded.data} />
          </>
        )}
    </section>
  );
}

export function WorksPage() {
  const { viewer } = useApp();
  const { id } = useParams();
  if (!viewer.isMember) {
    return (
      <section className="page narrow">
        <h1 className="page-title">作品</h1>
        <p>作品の一覧は、参加者として登録された人だけが見られます。</p>
      </section>
    );
  }
  return id ? <WorkPage key={id} id={id} /> : <WorkList />;
}
