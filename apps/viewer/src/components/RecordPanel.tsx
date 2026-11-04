// 承認の画面の右側: この記事で記録すること（書いた人・登場する人・公開）
//
// 無料の情報源（公式ブログなど）の投稿は、公開・無料が決まっているので選ばせない。変えたいときは
// 「詳しく直す」から変える。

import type { DraftInput } from "@aletheia/intake/draft";
import { Check, X } from "lucide-react";
import { authorsOf, mentionsOf, setMention } from "../source/tags.ts";
import type { RefLabel } from "../source/types.ts";
import { PersonSelect } from "./PersonSelect.tsx";

export function RecordPanel({
  draft,
  onChange,
  candidates,
  name,
  channelAvailability,
  readOnly,
}: {
  draft: DraftInput;
  onChange: (d: DraftInput) => void;
  candidates: RefLabel[];
  name: (id: string) => string;
  channelAvailability: string | null;
  readOnly: boolean;
}) {
  const authors = authorsOf(draft);
  const mentions = mentionsOf(draft);
  const fixedPublic =
    channelAvailability === "free" &&
    draft.post.classification === "public" &&
    (draft.post.availability ?? "free") === "free";

  return (
    <section className="panel panel-pad record" aria-labelledby="record-title">
      <h3 id="record-title" className="column-title">
        この記事で記録すること
      </h3>

      <dl className="record-list">
        <dt>書いた人</dt>
        <dd>{authors.length > 0 ? authors.map(name).join("・") : "（なし）"}</dd>

        <dt>登場する人</dt>
        <dd>
          <div className="record-people" role="group" aria-label="投稿に登場する人">
            {mentions.length === 0 && <span className="quiet">まだいません</span>}
            {mentions.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`person-chip ${m.on ? "is-on" : "is-off"}`}
                aria-pressed={m.on}
                disabled={readOnly}
                title={
                  m.on
                    ? "押すと外します"
                    : "外しました（本文から見つけた候補として記録に残ります）。押すと戻します"
                }
                onClick={() => onChange(setMention(draft, m.id, !m.on))}
              >
                {m.on ? <Check size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
                {name(m.id)}
              </button>
            ))}
            <PersonSelect
              candidates={candidates}
              exclude={mentions.filter((m) => m.on).map((m) => m.id)}
              label="登場する人を足す"
              disabled={readOnly}
              onPick={(id) => onChange(setMention(draft, id, true))}
            />
          </div>
        </dd>

        <dt>公開</dt>
        <dd>
          {fixedPublic ? (
            <span>公開・無料（無料の情報源）</span>
          ) : (
            <span>
              {draft.post.classification === "public" ? "公開" : "非公開"}
              {draft.post.availability === "paid" && "・有料"}
              <span className="quiet">（変えるときは「詳しく直す」から）</span>
            </span>
          )}
        </dd>
      </dl>
    </section>
  );
}
