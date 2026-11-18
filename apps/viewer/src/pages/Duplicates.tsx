// 似た画像の画面（設計書 決定記録 0069）: 見た目が似た保存済みの画像の組を並べ、「同じ画像」か「別の画像」を
// 決める。どちらにしてもファイルは消さない。作業者・運営者が使う

import { useState } from "react";
import { SimilarAssetCard } from "../components/SimilarImages.tsx";
import { useApp } from "../context.tsx";
import type { DuplicatePair } from "../source/types.ts";
import { useLoad } from "../use-load.ts";

export function DuplicatesPage() {
  const { source, viewer } = useApp();
  const [version, setVersion] = useState(0);
  const [list] = useLoad(() => source.listDuplicates(), [source], [version]);
  const [decided, setDecided] = useState<Map<string, "same" | "distinct">>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (!viewer.canWork) {
    return (
      <section className="page narrow">
        <h1 className="page-title">似た画像</h1>
        <p>似た画像の画面は、作業者と運営者が使えます。</p>
      </section>
    );
  }

  const decide = async (pair: DuplicatePair, decision: "same" | "distinct") => {
    setBusy(pair.id);
    setFailure(null);
    try {
      await source.decideDuplicate(pair.id, decision);
      setDecided((prev) => new Map(prev).set(pair.id, decision));
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const items = list.status === "ready" ? list.data.items : [];
  const open = items.filter((p) => !decided.has(p.id));

  return (
    <section className="page">
      <div className="page-head">
        <h1 className="page-title">似た画像</h1>
        <p className="page-sub">
          見た目が似ている保存済みの画像の組
          {list.status === "ready" && ` — 残り ${Math.max(list.data.total - decided.size, 0)} 組`}
        </p>
      </div>
      <p className="quiet">
        別々の経路から入った同じ画像を見つけるためのものです。「同じ画像」にしても「別の画像」にしても、ファイルは消しません。連写など、似ているだけの別の写真は「別の画像」にしてください。
      </p>
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
      {list.status === "loading" && <p className="quiet">読み込んでいます</p>}
      {list.status === "error" && (
        <p className="error" role="alert">
          読めませんでした: {list.error.message}
        </p>
      )}
      {list.status === "ready" && open.length === 0 && (
        <p className="empty">
          確かめる組はありません。
          {list.data.total > decided.size && (
            <button type="button" className="link-button" onClick={() => setVersion((v) => v + 1)}>
              続きを読む
            </button>
          )}
        </p>
      )}
      <ol className="duplicate-list">
        {open.map((pair) => (
          <li
            key={pair.id}
            className="panel panel-pad duplicate-pair"
            aria-label={`似た画像の組（違い ${pair.distance ?? "不明"}/64）`}
          >
            <div className="similar-matches">
              <SimilarAssetCard asset={pair.left} />
              <SimilarAssetCard asset={pair.right} />
            </div>
            <div className="similar-actions">
              <span className="quiet">違い {pair.distance ?? "不明"}/64</span>
              <button
                type="button"
                className="button small"
                disabled={busy !== null}
                onClick={() => void decide(pair, "same")}
              >
                同じ画像
              </button>
              <button
                type="button"
                className="button small"
                disabled={busy !== null}
                onClick={() => void decide(pair, "distinct")}
              >
                別の画像
              </button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
