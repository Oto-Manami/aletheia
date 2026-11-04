// 承認の画面のタグ付け: 投稿に登場する人と、写真ごとに写っている人を選ぶ
//
// 候補は、タグ付けの候補（entities.attributes.tag_candidate）に入っている人（メンバーなど）。
// 規則が本文から見つけた人は最初から並び、人が採用・不採用を決める。

import { type DraftInput } from "@aletheia/intake/draft";
import { Check, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import {
  appearsOf,
  authorsOf,
  imageRefsOf,
  mentionsOf,
  setAppears,
  setAppearsAll,
  setMention,
} from "../source/tags.ts";
import type { RefLabel } from "../source/types.ts";

interface Props {
  draft: DraftInput;
  onChange: (d: DraftInput) => void;
  candidates: RefLabel[];
  labels: Map<string, string>;
  previews: Record<string, string>;
  readOnly: boolean;
}

function previewOf(draft: DraftInput, ref: string, previews: Record<string, string>) {
  const source = (draft.assets ?? []).find((a) => a.ref === ref)?.attributes?.["source_url"];
  return previews[ref] ?? (typeof source === "string" ? source : null);
}

function PersonSelect({
  candidates,
  exclude,
  label,
  onPick,
  disabled,
}: {
  candidates: RefLabel[];
  exclude: string[];
  label: string;
  onPick: (id: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  const options = candidates.filter((c) => !exclude.includes(c.id));
  return (
    <span className="tag-picker">
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <select
        id={id}
        value=""
        disabled={disabled || options.length === 0}
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value);
        }}
      >
        <option value="">＋ {label}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export function MemberTags({ draft, onChange, candidates, labels, previews, readOnly }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const name = (id: string) =>
    labels.get(id) ?? candidates.find((c) => c.id === id)?.label ?? "（名前を読み込み中）";
  const mentions = mentionsOf(draft);
  const images = imageRefsOf(draft);
  const authors = authorsOf(draft);

  return (
    <section className="panel panel-pad member-tags" aria-labelledby="member-tags-title">
      <h3 id="member-tags-title" className="column-title">
        登場する人・写っている人
      </h3>

      <div className="tag-row" role="group" aria-label="投稿に登場する人">
        <span className="tag-row-label">登場する人</span>
        {mentions.length === 0 && <span className="quiet">まだいません</span>}
        {mentions.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`person-chip ${m.on ? "is-on" : "is-off"}`}
            aria-pressed={m.on}
            disabled={readOnly}
            title={m.rule ? "本文から規則で見つけた候補" : "人が足したもの"}
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

      {images.length > 0 && (
        <>
          <div className="tag-row">
            <span className="tag-row-label">写っている人</span>
            {authors.map((a) => {
              const all = images.every((ref) => appearsOf(draft, ref).includes(a));
              return (
                <button
                  key={a}
                  type="button"
                  className="button"
                  disabled={readOnly}
                  onClick={() => onChange(setAppearsAll(draft, a, !all))}
                >
                  {all
                    ? `すべての写真から ${name(a)} を外す`
                    : `すべての写真に ${name(a)} を付ける`}
                </button>
              );
            })}
          </div>
          <ul className="photo-tags">
            {images.map((ref, i) => {
              const people = appearsOf(draft, ref);
              const preview = previewOf(draft, ref, previews);
              return (
                <li key={ref} className="photo-tag">
                  <div className="photo-tag-image">
                    {preview ? (
                      <img src={preview} alt={`写真 ${i + 1}`} loading="lazy" />
                    ) : (
                      <span className="triage-image-empty">写真 {i + 1}</span>
                    )}
                  </div>
                  <div
                    className="photo-tag-people"
                    role="group"
                    aria-label={`写真 ${i + 1} に写っている人`}
                  >
                    {people.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className="person-chip is-on"
                        disabled={readOnly}
                        aria-label={`${name(p)} を写真 ${i + 1} から外す`}
                        onClick={() => onChange(setAppears(draft, ref, p, false))}
                      >
                        {name(p)}
                        <X size={12} aria-hidden="true" />
                      </button>
                    ))}
                    {open === ref ? (
                      <PersonSelect
                        candidates={candidates}
                        exclude={people}
                        label={`写真 ${i + 1} に写っている人を足す`}
                        disabled={readOnly}
                        onPick={(id) => {
                          onChange(setAppears(draft, ref, id, true));
                          setOpen(null);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="link-button"
                        disabled={readOnly}
                        aria-label={`写真 ${i + 1} に写っている人を足す`}
                        onClick={() => setOpen(ref)}
                      >
                        <Plus size={12} aria-hidden="true" />
                        人を足す
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
