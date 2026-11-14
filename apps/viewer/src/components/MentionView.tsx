// 承認の画面の本文。蓄積対象（本人・期）への言及のある段落を先に見せ、全文は畳んでおく
//
// 登場するメンバーのタグ付けの候補（evidence.purpose = tag）の段落は出さない。名前は右側の
// 「本文に出てくる人」で付け外しする。本人のブログでは言及の段落は出さず、本文だけを畳んで置く。
//
// 言及の段落はチケットのように並べ、押すと「関係あり」の印が付く（設計書 決定記録 0056）。印を付けなくても
// 保存のしかたは変わらない。印は、言及の紐付けの根拠に残し、後で言及を文でまとめるときに使う。

import type { DraftInput } from "@aletheia/intake/draft";
import { isMarked, markedCount, toggleExcerpt } from "../source/excerpts.ts";
import { mentionParagraphs, paragraphsOf } from "../source/mention-view.ts";
import { Snippet } from "./Snippet.tsx";

function bodyOf(draft: DraftInput): string | null {
  for (const a of draft.assets ?? []) {
    const body = a.texts?.find((t) => t.text_type === "body");
    if (body) return body.content;
  }
  return null;
}

export function MentionView({
  draft,
  ownPost,
  onChange,
  readOnly = false,
}: {
  draft: DraftInput;
  ownPost: boolean;
  /** 印を付け外ししたら、新しい下書きを渡す（無ければ印を付けられない） */
  onChange?: (draft: DraftInput) => void;
  readOnly?: boolean;
}) {
  const paragraphs = ownPost
    ? []
    : mentionParagraphs(draft, (l) => l.evidence?.["purpose"] !== "tag");
  const body = bodyOf(draft);
  if (!body && paragraphs.length === 0) return null;

  return (
    <section className="panel panel-pad article" aria-labelledby="article-title">
      <h3 id="article-title" className="column-title">
        {paragraphs.length > 0 ? "言及しているところ" : "本文"}
      </h3>
      {paragraphs.length > 0 && onChange && (
        <p className="quiet mention-help">
          本人への言及として関係がある段落を押すと、「関係あり」の印が付きます（付けなくても保存は変わりません）。
          {markedCount(draft) > 0 && ` 印を付けた段落 ${markedCount(draft)} 件`}
        </p>
      )}
      {paragraphs.length > 0 && (
        <ul className="mention-tickets" aria-label="言及している段落">
          {paragraphs.map((p, i) => {
            const marked = isMarked(draft, p.range);
            const content = (
              <>
                <span className="mention-ticket-head">
                  {p.names.length > 0 && <span>{p.names.join("・")}</span>}
                  {marked && <span className="mention-ticket-mark">関係あり</span>}
                </span>
                <Snippet snippet={p} className="mention-text" inline />
              </>
            );
            return (
              <li key={i}>
                {onChange ? (
                  <button
                    type="button"
                    className={`mention-ticket ${marked ? "is-marked" : ""}`}
                    aria-pressed={marked}
                    aria-label={`言及している段落 ${i + 1}（${p.names.join("・")}）に「関係あり」の印を${marked ? "付けている" : "付ける"}`}
                    disabled={readOnly}
                    onClick={() => onChange(toggleExcerpt(draft, p.range))}
                  >
                    {content}
                  </button>
                ) : (
                  <div className={`mention-ticket ${marked ? "is-marked" : ""}`}>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {body && (
        <details className="article-more">
          <summary className="link-button">本文をすべて読む</summary>
          <div className="article-body">
            {paragraphsOf(body).map((p, i) => (
              <p key={i}>{body.slice(p.from, p.to)}</p>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
