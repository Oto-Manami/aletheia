// 振り分け（管理者だけ。設計書 決定記録 0021）
//
// 全件を取り込んだメンバーのブログを、1 記事ずつ「残す」か「言及なし」に分ける。
// - 言及の有無（本文で見つかった別名の数）と、本文の該当箇所を印つきで見せる
// - 画像を並べ、本人が写っている画像をクリックで選ぶ（画像だけの登場は規則では見つけられない）
// - 言及も写っている画像も無い記事は、まとめて「言及なし」にできる

import { Check, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Snippet } from "../components/Snippet.tsx";
import { useApp } from "../context.tsx";
import { formatInstant } from "../format.ts";
import { matchesMention, TRIAGE_FILTERS, withAppears } from "../source/triage.ts";
import type { TriageCounts, TriageItem, TriageMentionFilter, TriageSort } from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { useLayout } from "./Layout.tsx";

const FILTER_LABELS: Record<TriageMentionFilter, string> = {
  all: "すべて",
  any: "言及あり",
  subject: "本人への言及",
  group_only: "期への言及だけ",
  none: "言及なし",
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
}: {
  item: TriageItem;
  selected: boolean;
  onSelect: (on: boolean) => void;
  appears: Record<string, boolean>;
  onToggleImage: (ref: string) => void;
  onKeep: () => Promise<void>;
  /** 言及なしにする（管理者だけ。参加者には出さない） */
  onDiscard: (() => Promise<void>) | null;
}) {
  const [busy, setBusy] = useState(false);
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

  return (
    <li
      className={`panel triage-card ${hasSignal(item, appears) ? "has-signal" : ""} ${
        item.subjectMentions === 0 && item.groupMentions > 0 ? "is-group-only" : ""
      }`}
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
            {item.channelName}
            {item.publishedAt && <> ・ {formatInstant(item.publishedAt)}</>}
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
          <span className="tag triage-none">言及なし</span>
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

      <div className="triage-actions">
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
        {item.images.length > 0 && (
          <span className="quiet triage-picked">
            写っている {picked} / {item.images.length} 枚
          </span>
        )}
        {onDiscard && (
          <button type="button" className="button" disabled={busy} onClick={() => run(onDiscard)}>
            言及なし
          </button>
        )}
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() => run(onKeep)}
        >
          残す
        </button>
      </div>
    </li>
  );
}

export function TriagePage() {
  const { source, viewer } = useApp();
  const layout = useLayout();
  const [params, setParams] = useSearchParams();
  const mention = TRIAGE_FILTERS.find((f) => f === params.get("mention")) ?? "all";
  const sort: TriageSort = params.get("sort") === "signal" ? "signal" : "oldest";
  const [list, reload] = useLoad(
    () => source.listTriage({ mention, sort }),
    [source, mention, sort],
  );
  const [appears, setAppears] = useState<Record<string, Record<string, boolean>>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!viewer.isMember) {
    return (
      <section className="page narrow">
        <h1 className="page-title">振り分け</h1>
        <p>振り分けの画面は、参加者として登録された人だけが使えます。</p>
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

  const discard = async (ids: string[]) => {
    const result = await source.discardTriage(ids);
    finish(result.done);
    if (result.failed.length > 0) {
      throw new Error(`${result.failed.length} 件を言及なしにできませんでした`);
    }
    return result.done.length;
  };

  // 言及ありの中は、本人への言及・期への言及だけ、をさらに選べる
  const mentionTab = mention === "any" || mention === "subject" || mention === "group_only";
  const tabs: { key: TriageMentionFilter; label: string; selected: boolean }[] = [
    { key: "all", label: "すべて", selected: mention === "all" },
    { key: "any", label: "言及あり", selected: mentionTab },
    { key: "none", label: "言及なし", selected: mention === "none" },
  ];
  const count = (f: TriageMentionFilter) => (counts ? ` ${counts[f].toLocaleString("ja-JP")}` : "");

  return (
    <section className="page wide">
      <div className="page-head">
        <h1 className="page-title">振り分け</h1>
        <p className="page-sub">
          メンバーのブログです。言及があるもの・本人が写っているものを残し、それ以外は運営者が「言及なし」として確認済みにします（本文と画像は残しません）。
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
        {viewer.isAdmin ? (
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
              disabled={selected.size === 0 || bulkBusy}
              onClick={() => {
                setBulkBusy(true);
                setMessage(null);
                discard([...selected])
                  .then((n) => setMessage(`${n} 件を言及なしにしました`))
                  .catch((e: unknown) => setMessage(e instanceof Error ? e.message : String(e)))
                  .finally(() => setBulkBusy(false));
              }}
            >
              選んだ {selected.size} 件を言及なしにする
            </button>
          </div>
        ) : (
          <p className="quiet triage-bulk">
            「言及なし」は運営者が判断します。言及や本人の写っている写真があれば「残す」を押してください。
          </p>
        )}
      </div>
      {counts && total !== null && (
        <p className="quiet triage-total">
          振り分け待ちは全 {counts.all.toLocaleString("ja-JP")} 件です。
          {mention !== "all" &&
            `このうち「${FILTER_LABELS[mention]}」は ${total.toLocaleString("ja-JP")} 件。`}
          {more &&
            `${sort === "signal" ? "言及の強い順" : "古い順"}に ${items.length.toLocaleString("ja-JP")} 件を表示しています。`}
          {sort === "signal" && "本人への言及の多いもの、期への言及の多いもの、の順です。"}
        </p>
      )}
      {message && (
        <p className="quiet" role="status">
          {message}
        </p>
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
        <p className="quiet">振り分け待ちの記事はありません。</p>
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
            onDiscard={viewer.isAdmin ? () => discard([item.id]).then(() => undefined) : null}
          />
        ))}
      </ul>
    </section>
  );
}
