// 振り分け（管理者だけ。設計書 決定記録 0021）
//
// 全件を取り込んだメンバーのブログを、1 記事ずつ「残す」か「言及なし」に分ける。
// - 言及の有無（本文で見つかった別名の数）と、本文の該当箇所を印つきで見せる
// - 画像を並べ、本人が写っている画像をクリックで選ぶ（画像だけの登場は規則では見つけられない）
// - 言及も写っている画像も無い記事は、まとめて「言及なし」にできる

import { Check, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useApp } from "../context.tsx";
import { formatInstant } from "../format.ts";
import { withAppears } from "../source/triage.ts";
import type { TriageItem, TriageSnippet } from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { useLayout } from "./Layout.tsx";

type Filter = "all" | "mention" | "none";

function Snippet({ snippet }: { snippet: TriageSnippet }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  snippet.marks.forEach(([s, e], i) => {
    if (s > at) parts.push(snippet.text.slice(at, s));
    parts.push(<mark key={i}>{snippet.text.slice(s, e)}</mark>);
    at = e;
  });
  if (at < snippet.text.length) parts.push(snippet.text.slice(at));
  return <p className="triage-snippet">{parts}</p>;
}

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
  onDiscard: () => Promise<void>;
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
    <li className={`panel triage-card ${hasSignal(item, appears) ? "has-signal" : ""}`}>
      <div className="triage-head">
        <input
          type="checkbox"
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
        {item.mentionCount > 0 ? (
          <span className="tag triage-mention" title={item.aliases.join("・")}>
            言及 {item.mentionCount}
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
        <button type="button" className="button" disabled={busy} onClick={() => run(onDiscard)}>
          言及なし
        </button>
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
  const [list, reload] = useLoad(() => source.listTriage(), [source]);
  const [filter, setFilter] = useState<Filter>("all");
  const [appears, setAppears] = useState<Record<string, Record<string, boolean>>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!viewer.isAdmin) {
    return (
      <section className="page narrow">
        <h1 className="page-title">振り分け</h1>
        <p>振り分けの画面は運営者だけが使えます。</p>
      </section>
    );
  }

  const items = list.status === "ready" ? list.data.filter((i) => !gone.has(i.id)) : [];
  const appearsOf = (id: string) => appears[id] ?? {};
  const counts = {
    all: items.length,
    mention: items.filter((i) => hasSignal(i, appearsOf(i.id))).length,
    none: items.filter((i) => !hasSignal(i, appearsOf(i.id))).length,
  };
  const shown = items.filter((i) =>
    filter === "all" ? true : (filter === "mention") === hasSignal(i, appearsOf(i.id)),
  );

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

  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: "すべて" },
    { key: "mention", label: "言及・写真あり" },
    { key: "none", label: "言及なし" },
  ];

  return (
    <section className="page wide">
      <div className="page-head">
        <h1 className="page-title">振り分け</h1>
        <p className="page-sub">
          メンバーのブログです。言及があるもの・本人が写っているものを残し、それ以外は「言及なし」として確認済みにします（本文と画像は残しません）。
        </p>
      </div>

      <div className="triage-toolbar">
        <div className="tabs" role="tablist" aria-label="絞り込み">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={filter === t.key}
              className="tab"
              onClick={() => setFilter(t.key)}
            >
              {t.label} {counts[t.key]}
            </button>
          ))}
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
      </div>
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
      {list.status === "ready" && shown.length === 0 && (
        <p className="quiet">振り分け待ちの記事はありません。</p>
      )}

      <ul className="triage-list" aria-label="振り分け待ちの記事">
        {shown.map((item) => (
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
            onDiscard={() => discard([item.id]).then(() => undefined)}
          />
        ))}
      </ul>
    </section>
  );
}
