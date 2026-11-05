// 承認の画面の本文。蓄積対象（本人・期）への言及のある段落を先に見せ、全文は畳んでおく
//
// 登場するメンバーのタグ付けの候補（evidence.purpose = tag）の段落は出さない。名前は右側の
// 「本文に出てくる人」で付け外しする。本人のブログでは言及の段落は出さず、本文だけを畳んで置く。

import type { DraftInput } from "@aletheia/intake/draft";
import { mentionParagraphs, paragraphsOf } from "../source/mention-view.ts";
import { Snippet } from "./Snippet.tsx";

function bodyOf(draft: DraftInput): string | null {
  for (const a of draft.assets ?? []) {
    const body = a.texts?.find((t) => t.text_type === "body");
    if (body) return body.content;
  }
  return null;
}

export function MentionView({ draft, ownPost }: { draft: DraftInput; ownPost: boolean }) {
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
      {paragraphs.map((p, i) => (
        <figure key={i} className="mention-paragraph">
          {p.names.length > 0 && <figcaption>{p.names.join("・")}</figcaption>}
          <Snippet snippet={p} className="mention-text" />
        </figure>
      ))}
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
