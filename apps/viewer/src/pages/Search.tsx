import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useApp } from "../context.tsx";
import { formatInstant, formatDate, TEXT_TYPE_LABELS } from "../format.ts";
import { useLoad } from "../use-load.ts";

function formatHitDate(value: string | null): string | null {
  if (!value) return null;
  return value.length > 10 ? formatInstant(value) : formatDate(value, "day");
}

export function SearchPage() {
  const { source } = useApp();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [input, setInput] = useState(query);
  const [hits] = useLoad(() => source.search(query), [source, query]);

  return (
    <section className="page">
      <h1 className="page-title">探す</h1>
      <form
        className="search-form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(input.trim() ? { q: input.trim() } : {});
        }}
      >
        <label htmlFor="search-q" className="visually-hidden">
          探す言葉
        </label>
        <input
          id="search-q"
          type="search"
          className="search-input"
          placeholder="言葉で探す（本文・キャプション・誌面の文字・書き起こし）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="button primary">
          探す
        </button>
      </form>

      {!query && (
        <p className="quiet">
          覚えている言葉の一部で探せます。全角・半角の違いは気にしなくて大丈夫です。
        </p>
      )}
      {query && hits.status === "loading" && <p className="quiet">探しています</p>}
      {query && hits.status === "error" && (
        <p className="error" role="alert">
          探せませんでした: {hits.error.message}
        </p>
      )}
      {query && hits.status === "ready" && (
        <>
          <p className="result-count">
            「{query}」 {hits.data.length} 件
          </p>
          {hits.data.length === 0 && (
            <p className="quiet">
              見つかりませんでした。言葉を短くするか、別の言い方で探してください。
            </p>
          )}
          <ol className="hits">
            {hits.data.map((h) => (
              <li key={`${h.assetId}:${h.textType}`} className="hit">
                <p
                  className="words hit-snippet"
                  // データベース（PGroonga）が作った、一致した部分だけを囲んだ HTML
                  dangerouslySetInnerHTML={{ __html: h.snippetHtml }}
                />
                <p className="hit-meta">
                  {h.postId ? (
                    <Link to={`/posts/${h.postId}`}>{h.postTitle ?? "（題名なし）"}</Link>
                  ) : (
                    <span>（投稿に属さない素材）</span>
                  )}
                  <span className="sep" aria-hidden="true" />
                  {h.channelName}
                  {formatHitDate(h.date) && (
                    <>
                      <span className="sep" aria-hidden="true" />
                      {formatHitDate(h.date)}
                    </>
                  )}
                  <span className="sep" aria-hidden="true" />
                  {TEXT_TYPE_LABELS[h.textType] ?? h.textType}
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
