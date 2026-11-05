// 承認の画面の写真。写真を押すと、蓄積対象の人物（本人）が写っている印を付け外しする。
// 一緒に写っている人は、写真の下のプルダウンから選ぶ。
//
// 写真は元の並びのまま出す（押したときに並びが変わらないように）。

import type { DraftInput } from "@aletheia/intake/draft";
import { Check, X } from "lucide-react";
import { appearsOf, imageRefsOf, setAppears, setAppearsAll } from "../source/tags.ts";
import type { RefLabel } from "../source/types.ts";
import { PersonSelect } from "./PersonSelect.tsx";

function previewOf(draft: DraftInput, ref: string, previews: Record<string, string>) {
  const source = (draft.assets ?? []).find((a) => a.ref === ref)?.attributes?.["source_url"];
  return previews[ref] ?? (typeof source === "string" ? source : null);
}

export function PhotoTags({
  draft,
  onChange,
  subject,
  candidates,
  name,
  previews,
  readOnly,
}: {
  draft: DraftInput;
  onChange: (d: DraftInput) => void;
  /** 写真を押して印を付ける人（蓄積対象の人物）。読み込み中は null */
  subject: RefLabel | null;
  candidates: RefLabel[];
  name: (id: string) => string;
  previews: Record<string, string>;
  readOnly: boolean;
}) {
  const refs = imageRefsOf(draft);
  if (refs.length === 0) return null;
  const marked = subject ? refs.filter((ref) => appearsOf(draft, ref).includes(subject.id)) : [];
  const all = subject !== null && marked.length === refs.length;
  const others = candidates.filter((c) => c.id !== subject?.id);

  return (
    <section className="panel panel-pad photos" aria-labelledby="photos-title">
      <header className="photos-head">
        <div className="photos-title">
          <h3 id="photos-title" className="column-title">
            写真 {refs.length} 枚
          </h3>
          <p className="photos-lead">
            {subject ? (
              <>
                <strong>{subject.label}</strong> が写っている写真を押して印を付けます。
                一緒に写っている人は、写真の下から選びます。
              </>
            ) : (
              "読み込んでいます"
            )}
          </p>
        </div>
        {subject && (
          <div className="photos-count">
            <span className="photos-count-number" aria-live="polite">
              {marked.length} / {refs.length} 枚
            </span>
            <button
              type="button"
              className="link-button"
              disabled={readOnly}
              onClick={() => onChange(setAppearsAll(draft, subject.id, !all))}
            >
              {all ? "すべて外す" : "すべてに付ける"}
            </button>
          </div>
        )}
      </header>
      <ul className={`photo-tags ${marked.length > 0 ? "has-marks" : ""}`}>
        {refs.map((ref, i) => {
          const n = i + 1;
          const people = appearsOf(draft, ref);
          const on = subject !== null && people.includes(subject.id);
          const rest = people.filter((p) => p !== subject?.id);
          const preview = previewOf(draft, ref, previews);
          return (
            <li key={ref} className={`photo-tag ${on ? "is-on" : ""}`}>
              <button
                type="button"
                className="photo-tag-image"
                aria-pressed={on}
                aria-label={
                  subject
                    ? `写真 ${n}${on ? `（${subject.label} の印あり。押すと外す）` : `（押すと ${subject.label} の印を付ける）`}`
                    : `写真 ${n}`
                }
                disabled={readOnly || !subject}
                onClick={() => subject && onChange(setAppears(draft, ref, subject.id, !on))}
              >
                {preview ? (
                  <img src={preview} alt="" loading="lazy" />
                ) : (
                  <span className="triage-image-empty">写真 {n}</span>
                )}
                {on && subject && (
                  <span className="photo-tag-mark" aria-hidden="true">
                    <Check size={12} />
                    {subject.label}
                  </span>
                )}
                <span className="photo-tag-number" aria-hidden="true">
                  {n}
                </span>
              </button>
              <div
                className="photo-tag-people"
                role="group"
                aria-label={`写真 ${n} に一緒に写っている人`}
              >
                {rest.map((p) => (
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
                  candidates={others}
                  exclude={people}
                  label={`写真 ${n} に一緒に写っている人を足す`}
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
