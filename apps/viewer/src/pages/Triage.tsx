// 振り分け（作業者・運営者。設計書 決定記録 0021・0032）
//
// 全件を取り込んだメンバーのブログ・公式サイトのニュースを、1 記事ずつ分ける。画像を選ぶ意味が違うため、
// ブログ（/triage/blog）とニュース（/triage/news）で画面を分ける（決定記録 0038）。
// - 言及の有無（本文で見つかった別名の数）と、本文の該当箇所を印つきで見せる
// - 画像を並べ、本人が写っている画像をクリックで選ぶ（画像だけの登場は規則では見つけられない）
// - 言及も写っている画像も無い記事は、まとめて「言及なし」にできる

import { Check, ExternalLink, ImageIcon, Undo2 } from "lucide-react";
import { type MouseEvent, useMemo, useState } from "react";
import type { DraftInput } from "@aletheia/intake/draft";
import { useParams, useSearchParams } from "react-router";
import { EventLinks } from "../components/EventLinks.tsx";
import { Snippet } from "../components/Snippet.tsx";
import { useApp } from "../context.tsx";
import { formatInstant } from "../format.ts";
import { newsDates } from "../source/news-dates.ts";
import { confirmPeopleTags, eventsOf } from "../source/tags.ts";
import {
  matchesMention,
  newsDraftWithImages,
  TRIAGE_FILTERS,
  withAppears,
} from "../source/triage.ts";
import type {
  DiscardedItem,
  TriageCounts,
  TriageItem,
  TriageMentionFilter,
  TriageSort,
} from "../source/types.ts";
import { TRIAGE_ROUTES, triageRouteOf } from "../triage-routes.ts";
import { useLoad } from "../use-load.ts";
import { useLayout } from "./Layout.tsx";

const FILTER_LABELS: Record<TriageMentionFilter, string> = {
  all: "すべて",
  any: "言及あり",
  subject: "本人への言及",
  group_only: "期への言及だけ",
  none: "言及なし",
  unnamed: "メンバーの名前なし",
  others_only: "ほかのメンバーの名前だけ",
};

function hasSignal(item: TriageItem, appears: Record<string, boolean>): boolean {
  return item.mentionCount > 0 || item.images.some((img) => appears[img.ref] ?? img.appears);
}

function TriageCard({
  item,
  selected,
  onSelect,
  appears,
  onToggleImage,
  onKeep,
  onDiscard,
  onToEvents,
}: {
  item: TriageItem;
  selected: boolean;
  onSelect: (on: boolean) => void;
  appears: Record<string, boolean>;
  onToggleImage: (ref: string) => void;
  onKeep: () => Promise<void>;
  /** 言及なしにする（作業者・運営者。決定記録 0032） */
  onDiscard: (() => Promise<void>) | null;
  /** ニュースを出来事に紐付けて保存する（出来事への紐付けを足した下書き） */
  onToEvents: (draft: DraftInput) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  // 公式サイトのニュースは、残す代わりに既にある出来事に紐付ける（設計書 決定記録 0029・0030）
  const news = item.channelKind === "web";
  const [toEvents, setToEvents] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    fn().catch((e: unknown) => {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    });
  };
  const picked = item.images.filter((img) => appears[img.ref] ?? img.appears).length;

  // 言及なしにするものを選ぶとき、記事のどこを押しても選べるようにする（チェックの箱は小さいため）。
  // 画像・リンク・ボタン・入力欄・出来事に紐付ける欄と、文字を選んでいるときは除く
  const selectByCard = (e: MouseEvent<HTMLLIElement>) => {
    if (!onDiscard) return;
    const target = e.target as HTMLElement;
    if (target.closest("a, button, input, select, textarea, label, .news-events")) return;
    if (window.getSelection()?.toString()) return;
    onSelect(!selected);
  };

  return (
    // キーボードでは、記事の頭のチェックの箱で選ぶ（ここは押す範囲を広げるだけ）
    <li
      className={`panel triage-card ${hasSignal(item, appears) ? "has-signal" : ""} ${
        item.subjectMentions === 0 && item.groupMentions > 0 ? "is-group-only" : ""
      } ${onDiscard ? "is-selectable" : ""} ${selected ? "is-selected" : ""}`}
      onClick={selectByCard}
    >
      <div className="triage-head">
        <input
          type="checkbox"
          hidden={!onDiscard}
          checked={selected}
          aria-label={`${item.title ?? "（題名なし）"} を選ぶ`}
          onChange={(e) => onSelect(e.target.checked)}
        />
        <div className="triage-title">
          <span className="triage-source">
            {item.category && <span className="tag triage-category">{item.category}</span>}
            {item.channelName}
            {item.publishedAt && (
              <>
                {" "}
                ・{" "}
                {item.publishedAt.length > 10
                  ? formatInstant(item.publishedAt)
                  : item.publishedAt.replaceAll("-", "/")}
              </>
            )}
          </span>
          <span className="triage-name">
            {item.title ?? "（題名なし）"}
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="元の記事を開く"
                className="triage-link"
              >
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            )}
          </span>
        </div>
        {item.mentions.length > 0 ? (
          <span className="triage-mentions">
            {item.mentions.map((m) => (
              <span
                key={m.name}
                className={`tag triage-mention is-${m.level}`}
                title={m.aliases.join("・")}
              >
                {m.name} {m.count}
              </span>
            ))}
          </span>
        ) : (
          <span className="triage-mentions">
            <span className="tag triage-none">言及なし</span>
            {item.otherNames.length > 0 && (
              <span className="triage-others" title="本文に名前が出ている、ほかのメンバー">
                {item.otherNames.slice(0, 3).join("・")}
                {item.otherNames.length > 3 && ` ほか ${item.otherNames.length - 3} 人`}
              </span>
            )}
          </span>
        )}
      </div>

      {item.snippets.map((s, i) => (
        <Snippet key={i} snippet={s} />
      ))}

      {item.images.length > 0 && (
        <div className="triage-images" role="group" aria-label="画像（本人が写っているものを選ぶ）">
          {item.images.map((img, i) => {
            const on = appears[img.ref] ?? img.appears;
            return (
              <button
                key={img.ref}
                type="button"
                className={`triage-image ${on ? "is-on" : ""}`}
                aria-pressed={on}
                aria-label={`画像 ${i + 1}${on ? "（写っている）" : ""}`}
                onClick={() => onToggleImage(img.ref)}
              >
                {img.previewUrl ? (
                  <img src={img.previewUrl} alt="" loading="lazy" />
                ) : (
                  <span className="triage-image-empty">画像 {i + 1}</span>
                )}
                {on && (
                  <span className="triage-image-check" aria-hidden="true">
                    <Check size={14} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {toEvents && (
        <NewsEvents
          item={item}
          appears={appears}
          picked={picked}
          onCancel={() => setToEvents(false)}
          onSave={(draft) => onToEvents(draft)}
        />
      )}

      {!toEvents && (
        <div className="triage-actions">
          {error && (
            <span className="error" role="alert">
              {error}
            </span>
          )}
          {item.images.length > 0 && (
            <span className="quiet triage-picked">
              {news
                ? `保存する画像 ${picked} / ${item.images.length} 枚`
                : `写っている ${picked} / ${item.images.length} 枚（承認の画面で確かめます）`}
            </span>
          )}
          {onDiscard && (
            <button type="button" className="button" disabled={busy} onClick={() => run(onDiscard)}>
              {news ? "関係なし" : "言及なし"}
            </button>
          )}
          {news ? (
            <button type="button" className="button primary" onClick={() => setToEvents(true)}>
              出来事に紐付ける
            </button>
          ) : (
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => run(onKeep)}
            >
              承認待ちに残す
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function bodyOf(draft: DraftInput): string {
  return (draft.assets ?? [])
    .flatMap((a) => a.texts ?? [])
    .filter((t) => t.text_type === "body")
    .map((t) => t.content)
    .join("\n");
}

/**
 * ニュースを出来事に紐付ける。合う出来事が無ければ、題名・種類・日付だけでその場で作れる（詳細は出来事の
 * 画面で入れる）。保存すると、ニュースを素材として残し、出来事の出典にする（承認の一覧には回らない。
 * 設計書 決定記録 0029・0030・0033）
 */
function NewsEvents({
  item,
  appears,
  picked,
  onCancel,
  onSave,
}: {
  item: TriageItem;
  /** 画像ごとに、本人が写っているとして選んだか（選んだ画像だけを素材として残す。決定記録 0035） */
  appears: Record<string, boolean>;
  /** 選んだ画像の枚数 */
  picked: number;
  onCancel: () => void;
  onSave: (draft: DraftInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<DraftInput>(item.draft);
  const [labels, setLabels] = useState(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dates = useMemo(
    () =>
      newsDates({
        title: item.title ?? "",
        body: bodyOf(item.draft),
        publishedDate: item.publishedAt?.slice(0, 10) ?? null,
      }),
    [item],
  );
  const linked = eventsOf(draft);

  return (
    <div className="news-events" role="group" aria-label="このニュースを出来事に紐付ける">
      <EventLinks
        draft={draft}
        onChange={setDraft}
        name={(id) => labels.get(id) ?? "（出来事）"}
        onLabel={(ref) => setLabels((prev) => new Map(prev).set(ref.id, ref.label))}
        readOnly={busy}
        dates={dates}
        required
        allowCreate
        title="このニュースを紐付ける出来事"
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="triage-actions">
        <span className="quiet triage-picked">
          {linked.length > 0
            ? `出来事 ${linked.length} 件に、このニュースを出典として紐付けます`
            : "出来事を選ぶと、保存できます"}
          {item.images.length > 0 &&
            (picked > 0
              ? `。選んだ画像 ${picked} 枚を保存します`
              : "。画像は保存せず、記事のページと本文だけを残します")}
        </span>
        <button type="button" className="button" disabled={busy} onClick={onCancel}>
          やめる
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy || linked.length === 0}
          onClick={() => {
            setBusy(true);
            setError(null);
            // 選んだ画像（本人が写っている）だけを素材として残し、出来事にもつなぐ（決定記録 0035）
            onSave(newsDraftWithImages(confirmPeopleTags(draft), appears)).catch((e: unknown) => {
              setBusy(false);
              setError(e instanceof Error ? e.message : String(e));
            });
          }}
        >
          紐付けて保存
        </button>
      </div>
    </div>
  );
}

/**
 * 直近に言及なしにしたもの（10 件まで。戻せる。設計書 決定記録 0031）。開いたときだけ読み込み、
 * 振り分けの画面の表示とボタンを重くしない
 */
function RecentlyDiscarded({
  refresh,
  onRestored,
}: {
  refresh: number;
  onRestored: (item: DiscardedItem) => void;
}) {
  const { source } = useApp();
  const [open, setOpen] = useState(false);
  const [list, reload] = useLoad(
    () => (open ? source.listDiscarded() : Promise.resolve([])),
    [source, open, refresh],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restore = (item: DiscardedItem) => {
    setBusy(item.id);
    setError(null);
    source
      .restoreDiscarded(item.id)
      .then(() => {
        reload();
        onRestored(item);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        reload();
      })
      .finally(() => setBusy(null));
  };

  return (
    <details className="triage-discarded" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        直近に言及なし・関係なしにしたもの（ブログとニュースあわせて 10 件まで戻せます）
      </summary>
      {open && list.status === "loading" && <p className="quiet">読み込んでいます</p>}
      {open && list.status === "error" && (
        <p className="error" role="alert">
          読めませんでした: {list.error.message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {open && list.status === "ready" && list.data.length === 0 && (
        <p className="quiet">まだありません。</p>
      )}
      {open && list.status === "ready" && list.data.length > 0 && (
        <ul aria-label="直近に言及なし・関係なしにしたもの">
          {list.data.map((item) => (
            <li key={item.id}>
              <span className="event-material-channel">{item.channelName}</span>
              <span className="triage-discarded-title">
                {item.title ?? "（題名なし）"}
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label="元の記事を開く"
                    className="triage-link"
                  >
                    <ExternalLink size={13} aria-hidden="true" />
                  </a>
                )}
              </span>
              <span className="quiet triage-discarded-when">
                {item.discardedAt ? formatInstant(item.discardedAt) : ""}
                {item.discardedByName ? `（${item.discardedByName}）` : ""}
              </span>
              <button
                type="button"
                className="button"
                disabled={busy !== null}
                aria-label={`「${item.title ?? "（題名なし）"}」を振り分け待ちに戻す`}
                onClick={() => restore(item)}
              >
                <Undo2 size={14} aria-hidden="true" /> 戻す
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** まとめて言及なしにするとき、1 回に送る件数 */
const BULK_CHUNK = 20;

export function TriagePage() {
  const { source, viewer } = useApp();
  const layout = useLayout();
  const [params, setParams] = useSearchParams();
  // ブログとニュースで画面を分ける（決定記録 0038）。不明なものは routes.tsx でブログへ送る
  const from = triageRouteOf(useParams().route) ?? "blog";
  const route = TRIAGE_ROUTES[from];
  const mention = TRIAGE_FILTERS.find((f) => f === params.get("mention")) ?? "all";
  const sort: TriageSort = params.get("sort") === "signal" ? "signal" : "oldest";
  const [list, reload] = useLoad(
    () => source.listTriage({ mention, sort, source: from }),
    [source, mention, sort, from],
  );
  const [appears, setAppears] = useState<Record<string, Record<string, boolean>>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // 言及なしにしたら、開いている「直近に言及なしにしたもの」を読み直す
  const [discardVersion, setDiscardVersion] = useState(0);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  if (!viewer.canWork) {
    return (
      <section className="page narrow">
        <h1 className="page-title">{route.title}</h1>
        <p>
          振り分けの画面は、作業者と運営者が使えます。作業を手伝うときは、運営者に作業者にしてもらってください。
        </p>
      </section>
    );
  }

  const loaded = list.status === "ready" ? list.data.items : [];
  const items = loaded.filter((i) => !gone.has(i.id));
  // 件数は本当の数（画面に出すのは上限まで）。この画面で処理した分を引く
  const done = loaded.filter((i) => gone.has(i.id));
  const counts =
    list.status === "ready"
      ? (Object.fromEntries(
          TRIAGE_FILTERS.map((f) => [
            f,
            Math.max(0, list.data.counts[f] - done.filter((i) => matchesMention(i, f)).length),
          ]),
        ) as TriageCounts)
      : null;
  const total = counts ? Math.max(counts[mention], items.length) : null;
  const more = total !== null && total > items.length;
  const appearsOf = (id: string) => appears[id] ?? {};
  // 選んだもののうち、いま一覧に出ているものだけを数える（処理済み・読み直しで消えたものは除く）
  const shown = new Set(items.map((i) => i.id));
  const picked = [...selected].filter((id) => shown.has(id));

  const setView = (patch: { mention?: TriageMentionFilter; sort?: TriageSort }) => {
    const next = new URLSearchParams(params);
    const m = patch.mention ?? mention;
    const so = patch.sort ?? sort;
    if (m === "all") next.delete("mention");
    else next.set("mention", m);
    if (so === "oldest") next.delete("sort");
    else next.set("sort", so);
    setSelected(new Set());
    setParams(next);
  };

  const finish = (ids: string[]) => {
    setGone((g) => new Set([...g, ...ids]));
    setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))));
    layout.changed();
  };

  /**
   * 言及なしにする。たくさん選んだときは少しずつ送り、終わった分から一覧から消して進み具合を見せる
   * （1 回の問い合わせが長くなると、途中で切れて画面とデータベースが食い違うため）。
   * 失敗したときは一覧を読み直し、画面をデータベースに合わせる
   */
  const discard = async (ids: string[]) => {
    let done = 0;
    const failed: string[] = [];
    if (ids.length > 1) setProgress({ done: 0, total: ids.length });
    try {
      for (let i = 0; i < ids.length; i += BULK_CHUNK) {
        const chunk = ids.slice(i, i + BULK_CHUNK);
        const result = await source.discardTriage(chunk);
        finish(result.done);
        done += result.done.length;
        failed.push(...result.failed.map((f) => f.error));
        if (ids.length > 1) setProgress({ done: i + chunk.length, total: ids.length });
      }
    } catch (e) {
      reload();
      const reason = e instanceof Error ? e.message : String(e);
      throw new Error(
        `途中で止まりました（${reason}）。${done} 件は${route.discard}にしました。一覧を読み直しました`,
        { cause: e },
      );
    } finally {
      setProgress(null);
      if (done > 0) setDiscardVersion((v) => v + 1);
    }
    if (failed.length > 0) {
      reload();
      throw new Error(
        `${done} 件を${route.discard}にしました。${failed.length} 件はできませんでした（${failed[0]}）。一覧を読み直しました`,
      );
    }
    return done;
  };

  // 言及ありの中は、本人への言及・期への言及だけ、をさらに選べる
  const mentionTab = mention === "any" || mention === "subject" || mention === "group_only";
  // 言及なしの中は、メンバーの名前の無いもの・ほかのメンバーの名前だけのもの、をさらに選べる
  const noneTab = mention === "none" || mention === "unnamed" || mention === "others_only";
  const tabs: { key: TriageMentionFilter; label: string; selected: boolean }[] = [
    { key: "all", label: "すべて", selected: mention === "all" },
    { key: "any", label: "言及あり", selected: mentionTab },
    { key: "none", label: "言及なし", selected: noneTab },
  ];
  const count = (f: TriageMentionFilter) => (counts ? ` ${counts[f].toLocaleString("ja-JP")}` : "");

  return (
    <section className="page wide">
      <div className="page-head">
        <h1 className="page-title">{route.title}</h1>
        <p className="page-sub">{route.lead}</p>
        <p className="triage-rule">
          <ImageIcon size={16} aria-hidden="true" />
          {route.images}
        </p>
      </div>

      <div className="triage-toolbar">
        <div className="triage-views">
          <div className="tabs" role="tablist" aria-label="絞り込み">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={t.selected}
                className="tab"
                onClick={() => setView({ mention: t.key })}
              >
                {t.label}
                {count(t.key)}
              </button>
            ))}
          </div>
          {mentionTab && (
            <span className="triage-select">
              <label htmlFor="triage-mention">言及の対象</label>
              <select
                id="triage-mention"
                value={mention}
                onChange={(e) => setView({ mention: e.target.value as TriageMentionFilter })}
              >
                <option value="any">すべての言及{count("any")}</option>
                <option value="subject">本人への言及{count("subject")}</option>
                <option value="group_only">期への言及だけ{count("group_only")}</option>
              </select>
            </span>
          )}
          {noneTab && (
            <span className="triage-select">
              <label htmlFor="triage-none">名前の出方</label>
              <select
                id="triage-none"
                value={mention}
                onChange={(e) => setView({ mention: e.target.value as TriageMentionFilter })}
              >
                <option value="none">すべて{count("none")}</option>
                <option value="unnamed">メンバーの名前なし{count("unnamed")}</option>
                <option value="others_only">ほかのメンバーの名前だけ{count("others_only")}</option>
              </select>
            </span>
          )}
          <span className="triage-select">
            <label htmlFor="triage-sort">並び</label>
            <select
              id="triage-sort"
              value={sort}
              onChange={(e) => setView({ sort: e.target.value as TriageSort })}
            >
              <option value="oldest">古い順</option>
              <option value="signal">言及の強い順</option>
            </select>
          </span>
        </div>
        <div className="triage-bulk">
          <button
            type="button"
            className="button"
            onClick={() =>
              setSelected(
                new Set(items.filter((i) => !hasSignal(i, appearsOf(i.id))).map((i) => i.id)),
              )
            }
          >
            言及も写真の選択も無いものを選ぶ
          </button>
          <button
            type="button"
            className="button danger"
            disabled={picked.length === 0 || bulkBusy}
            onClick={() => {
              setBulkBusy(true);
              setMessage(null);
              discard(picked)
                .then((n) =>
                  setMessage({ text: `${n} 件を${route.discard}にしました`, error: false }),
                )
                .catch((e: unknown) =>
                  setMessage({ text: e instanceof Error ? e.message : String(e), error: true }),
                )
                .finally(() => setBulkBusy(false));
            }}
          >
            {progress
              ? `${route.discard}にしています（${progress.done} / ${progress.total} 件）`
              : `選んだ ${picked.length} 件を${route.discard}にする`}
          </button>
        </div>
      </div>
      {counts && total !== null && (
        <p className="quiet triage-total">
          振り分け待ちは全 {counts.all.toLocaleString("ja-JP")} 件です。
          {mention !== "all" &&
            `このうち「${FILTER_LABELS[mention]}」は ${total.toLocaleString("ja-JP")} 件。`}
          {more &&
            `${sort === "signal" ? "言及の強い順" : "古い順"}に ${items.length.toLocaleString("ja-JP")} 件を表示しています。`}
          {sort === "signal" &&
            "本人への言及の多いもの、期への言及の多いもの、メンバーの名前の無いもの、ほかのメンバーの名前だけのもの、の順です。"}
        </p>
      )}
      {message && (
        <p className={message.error ? "error" : "quiet"} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}
      {viewer.canWork && (
        <RecentlyDiscarded
          refresh={discardVersion}
          onRestored={(item) => {
            // 処理済みとして隠していたものを、また一覧に出す
            setGone((g) => new Set([...g].filter((id) => id !== item.id)));
            reload();
            setMessage({
              text: `「${item.title ?? "（題名なし）"}」を振り分け待ちに戻しました`,
              error: false,
            });
          }}
        />
      )}

      {list.status === "loading" && <p className="quiet">読み込んでいます</p>}
      {list.status === "error" && (
        <p className="error" role="alert">
          一覧を読めませんでした: {list.error.message}{" "}
          <button type="button" className="link-button" onClick={reload}>
            読み直す
          </button>
        </p>
      )}
      {list.status === "ready" && items.length === 0 && !more && (
        <p className="quiet">{route.empty}</p>
      )}
      {list.status === "ready" && items.length === 0 && more && (
        <p className="quiet">
          表示した記事は終わりました。{" "}
          <button type="button" className="link-button" onClick={reload}>
            続きを読み込む
          </button>
        </p>
      )}

      <ul className="triage-list" aria-label="振り分け待ちの記事">
        {items.map((item) => (
          <TriageCard
            key={item.id}
            item={item}
            selected={selected.has(item.id)}
            onSelect={(on) =>
              setSelected((s) => {
                const next = new Set(s);
                if (on) next.add(item.id);
                else next.delete(item.id);
                return next;
              })
            }
            appears={appearsOf(item.id)}
            onToggleImage={(ref) =>
              setAppears((a) => {
                const current = a[item.id] ?? {};
                const was = current[ref] ?? item.images.find((img) => img.ref === ref)?.appears;
                return { ...a, [item.id]: { ...current, [ref]: !was } };
              })
            }
            onKeep={() =>
              source
                .keepTriage(item.id, withAppears(item.draft, appearsOf(item.id)))
                .then(() => finish([item.id]))
            }
            onDiscard={viewer.canWork ? () => discard([item.id]).then(() => undefined) : null}
            onToEvents={async (draft) => {
              // 残すと承認を 1 回で行う。失敗したら振り分け待ちのまま（ニュースは承認の一覧に回さない）
              await source.keepAndApprove(item.id, draft);
              finish([item.id]);
            }}
          />
        ))}
      </ul>
    </section>
  );
}
