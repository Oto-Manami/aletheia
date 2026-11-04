// 承認の画面の記事: 言及のある段落を先に、全文はその下に（畳んでおく）

import type { DraftInput } from "@aletheia/intake/draft";
import { useState } from "react";
import { mentionParagraphs, paragraphsOf } from "../source/mention-view.ts";
import { Snippet } from "./Snippet.tsx";

function bodyOf(draft: DraftInput): string | null {
  for (const a of draft.assets ?? []) {
    const body = a.texts?.find((t) => t.text_type === "body");
    if (body) return body.content;
  }
  return null;
}

export function MentionView({ draft }: { draft: DraftInput }) {
  const paragraphs = mentionParagraphs(draft);
  const body = bodyOf(draft);
  const [showAll, setShowAll] = useState(paragraphs.length === 0);

  return (
    <section className="panel panel-pad article" aria-labelledby="article-title">
      <h3 id="article-title" className="column-title">
        {paragraphs.length > 0 ? `言及のある段落 ${paragraphs.length}` : "本文"}
      </h3>
      {paragraphs.map((p, i) => (
        <figure key={i} className="mention-paragraph">
          {p.names.length > 0 && <figcaption>{p.names.join("・")}</figcaption>}
          <Snippet snippet={p} className="mention-text" />
        </figure>
      ))}
      {body &&
        (showAll ? (
          <div className="article-body">
            {paragraphsOf(body).map((p, i) => (
              <p key={i}>{body.slice(p.from, p.to)}</p>
            ))}
          </div>
        ) : (
          <button type="button" className="link-button" onClick={() => setShowAll(true)}>
            本文をすべて読む
          </button>
        ))}
    </section>
  );
}
