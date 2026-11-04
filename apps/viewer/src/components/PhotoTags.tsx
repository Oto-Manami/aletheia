// 承認の画面の写真の一覧。写真ごとに、写っている人を付け外しする
//
// 振り分けで「本人が写っている」と選んだ写真には、最初から本人が付いている。ここでは一緒に写っている人を
// 足す。人が写っている写真を先に並べる（番号は元の並び）。

import type { DraftInput } from "@aletheia/intake/draft";
import { X } from "lucide-react";
import { appearsOf, authorsOf, imageRefsOf, setAppears, setAppearsAll } from "../source/tags.ts";
import type { RefLabel } from "../source/types.ts";
import { PersonSelect } from "./PersonSelect.tsx";

function previewOf(draft: DraftInput, ref: string, previews: Record<string, string>) {
  const source = (draft.assets ?? []).find((a) => a.ref === ref)?.attributes?.["source_url"];
  return previews[ref] ?? (typeof source === "string" ? source : null);
}

export function PhotoTags({
  draft,
  onChange,
  candidates,
  name,
  previews,
  readOnly,
}: {
  draft: DraftInput;
  onChange: (d: DraftInput) => void;
  candidates: RefLabel[];
  name: (id: string) => string;
  previews: Record<string, string>;
  readOnly: boolean;
}) {
  const refs = imageRefsOf(draft);
  if (refs.length === 0) return null;
  const numbered = refs.map((ref, i) => ({ ref, n: i + 1, people: appearsOf(draft, ref) }));
  // 人が写っている写真を先に（元の並びは保つ）
  const ordered = [
    ...numbered.filter((p) => p.people.length > 0),
    ...numbered.filter((p) => p.people.length === 0),
  ];
  const authors = authorsOf(draft);
  const tagged = numbered.filter((p) => p.people.length > 0).length;

  return (
    <section className="panel panel-pad photos" aria-labelledby="photos-title">
      <header className="photos-head">
        <h3 id="photos-title" className="column-title">
          写真 {refs.length} 枚<span className="quiet">人が写っている {tagged} 枚</span>
        </h3>
        {authors.map((a) => {
          const all = refs.every((ref) => appearsOf(draft, ref).includes(a));
          return (
            <button
              key={a}
              type="button"
              className="button"
              disabled={readOnly}
              onClick={() => onChange(setAppearsAll(draft, a, !all))}
            >
              {all ? `すべての写真から ${name(a)} を外す` : `すべての写真に ${name(a)} を付ける`}
            </button>
          );
        })}
      </header>
      <ul className="photo-tags">
        {ordered.map(({ ref, n, people }) => {
          const preview = previewOf(draft, ref, previews);
          return (
            <li key={ref} className={`photo-tag ${people.length > 0 ? "has-people" : ""}`}>
              <div className="photo-tag-image">
                {preview ? (
                  <img src={preview} alt={`写真 ${n}`} loading="lazy" />
                ) : (
                  <span className="triage-image-empty">写真 {n}</span>
                )}
                <span className="photo-tag-number">{n}</span>
              </div>
              <div
                className="photo-tag-people"
                role="group"
                aria-label={`写真 ${n} に写っている人`}
              >
                {people.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="person-chip is-on"
                    disabled={readOnly}
                    aria-label={`${name(p)} を写真 ${n} から外す`}
                    onClick={() => onChange(setAppears(draft, ref, p, false))}
                  >
                    {name(p)}
                    <X size={12} aria-hidden="true" />
                  </button>
                ))}
                <PersonSelect
                  candidates={candidates}
                  exclude={people}
                  label={`写真 ${n} に写っている人を足す`}
                  disabled={readOnly}
                  onPick={(id) => onChange(setAppears(draft, ref, id, true))}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
