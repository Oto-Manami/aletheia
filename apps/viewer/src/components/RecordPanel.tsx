// 承認の画面の右側: この記事で記録すること（書いた人・写っている人・本文に出てくる人・公開）
//
// 無料の情報源（公式ブログなど）の投稿は、公開・無料が決まっているので選ばせない。変えたいときは
// 「詳しく見る・直す」から変える。

import type { DraftInput } from "@aletheia/intake/draft";
import { Check, X } from "lucide-react";
import { appearsOf, authorsOf, imageRefsOf, mentionsOf, setMention } from "../source/tags.ts";
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
  const photos = imageRefsOf(draft);
  // 写っている人ごとの枚数
  const appears = new Map<string, number>();
  for (const ref of photos) {
    for (const p of appearsOf(draft, ref)) appears.set(p, (appears.get(p) ?? 0) + 1);
  }
  const fixedPublic =
    channelAvailability === "free" &&
    draft.post.classification === "public" &&
    (draft.post.availability ?? "free") === "free";

  return (
    <section className="record" aria-labelledby="record-title">
      <h3 id="record-title" className="column-title">
        この記事で記録すること
      </h3>

      <dl className="record-list">
        <dt>書いた人</dt>
        <dd>{authors.length > 0 ? authors.map(name).join("・") : "（なし）"}</dd>

        {photos.length > 0 && (
          <>
            <dt>写っている人</dt>
            <dd>
              {appears.size === 0 ? (
                <span className="quiet">まだ印がありません（写真を押して付けます）</span>
              ) : (
                <span className="record-appears">
                  {[...appears].map(([p, n]) => (
                    <span key={p}>
                      {name(p)} <span className="quiet">{n} 枚</span>
                    </span>
                  ))}
                </span>
              )}
            </dd>
          </>
        )}

        <dt>本文に出てくる人</dt>
        <dd>
          <div className="record-people" role="group" aria-label="本文に出てくる人">
            {mentions.length === 0 && <span className="quiet">いません</span>}
            {mentions.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`person-chip ${m.on ? "is-on" : "is-off"}`}
                aria-pressed={m.on}
                disabled={readOnly}
                title={m.on ? "押すと外します" : "外しました。押すと戻します"}
                onClick={() => onChange(setMention(draft, m.id, !m.on))}
              >
                {m.on ? <Check size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
                {name(m.id)}
              </button>
            ))}
            <PersonSelect
              candidates={candidates}
              exclude={mentions.filter((m) => m.on).map((m) => m.id)}
              label="本文に出てくる人を足す"
              disabled={readOnly}
              onPick={(id) => onChange(setMention(draft, id, true))}
            />
          </div>
        </dd>

        <dt>公開</dt>
        <dd>
          {fixedPublic ? (
            "公開・無料"
          ) : (
            <>
              {draft.post.classification === "public" ? "公開" : "非公開"}
              {draft.post.availability === "paid" && "・有料"}
            </>
          )}
        </dd>
      </dl>
    </section>
  );
}
