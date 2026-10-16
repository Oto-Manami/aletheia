// 下書きの確認と修正（承認の前に人が直すところ）
//
// 機械の提案（紐付け・言明）は消さずに「採用しない」にする。却下した提案も記録に残るため。

import type { DraftInput } from "@aletheia/intake/draft";
import { useId, useState } from "react";
import { AVAILABILITY_LABELS, MEDIA_LABELS, pageLabel, ROLE_LABELS } from "../format.ts";
import type { DraftWarning } from "../source/summarize.ts";
import type { ArchiveSource, IntakeIssue, RefLabel } from "../source/types.ts";

type Draft = DraftInput;
type Link = NonNullable<Draft["links"]>[number];
type Statement = NonNullable<Draft["statements"]>[number];

const PRECISIONS = [
  { value: "day", label: "日まで" },
  { value: "month", label: "月まで" },
  { value: "year", label: "年まで" },
] as const;

const ADDABLE_ROLES = ["mentions", "depicts", "appears", "covers", "part_of"] as const;

function pathKey(path: (string | number)[]): string {
  return path.join(".");
}

/** 下書きを複製して直す */
function edit(draft: Draft, fn: (d: Draft) => void): Draft {
  const next = structuredClone(draft);
  fn(next);
  return next;
}

function OriginBadge({
  p,
}: {
  p: { origin?: string | undefined; confidence?: number | undefined };
}) {
  const origin = p.origin ?? "human";
  if (origin === "human") return <span className="origin">人</span>;
  const label = { ai: "AI", rule: "ルール", import: "移行" }[origin] ?? origin;
  const confidence = p.confidence ?? 1;
  return (
    <span className="origin" title="付けた仕組みと確信度">
      {label} {Math.round(confidence * 100)}%
    </span>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: (id: string) => React.ReactNode;
  hint?: string | undefined;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** attributes の値を入れる・消す（空なら消す） */
function setAttr(
  attrs: Record<string, unknown> | undefined,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const next = { ...attrs };
  if (value === undefined || value === "") delete next[key];
  else next[key] = value;
  return next;
}

export interface DraftEditorProps {
  draft: Draft;
  onChange: (draft: Draft) => void;
  labels: Map<string, string>;
  issues: IntakeIssue[];
  warnings: DraftWarning[];
  source: ArchiveSource;
  readOnly: boolean;
  /** 追加した紐付けの行き先の表示名を覚える */
  onLabel: (ref: RefLabel) => void;
}

export function DraftEditor(props: DraftEditorProps) {
  const { draft, onChange, labels, issues, warnings, readOnly } = props;
  const post = draft.post;
  const warned = new Set(warnings.map((w) => pathKey(w.path)));
  const set = (fn: (d: Draft) => void) => onChange(edit(draft, fn));
  const fromLabel = (from: Link["from"]) => (from === "post" ? "投稿" : `素材 ${from.asset}`);
  const labelOf = (id: string | undefined) => (id ? (labels.get(id) ?? "読み込んでいます") : "");

  return (
    <fieldset className="editor" disabled={readOnly}>
      <legend className="visually-hidden">下書き</legend>

      {issues.length > 0 && (
        <div className="issues" role="alert">
          <p>承認する前に、次のところを直してください。</p>
          <ul>
            {issues.map((i, n) => (
              <li key={n}>
                <code>{i.path.join(" › ") || "下書き"}</code> {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="editor-section">
        <h2>投稿</h2>
        <Field label="題名">
          {(id) => (
            <input
              id={id}
              value={post.title ?? ""}
              onChange={(e) =>
                set((d) => {
                  if (e.target.value) d.post.title = e.target.value;
                  else delete d.post.title;
                })
              }
            />
          )}
        </Field>
        <div className={`field-row ${warned.has("post.published_date") ? "is-warned" : ""}`}>
          {post.published_at !== undefined ? (
            <Field label="日時" hint="+09:00 つきで書きます（例: 2026-10-15T21:58:00+09:00）">
              {(id) => (
                <input
                  id={id}
                  value={post.published_at ?? ""}
                  onChange={(e) => set((d) => void (d.post.published_at = e.target.value))}
                />
              )}
            </Field>
          ) : (
            <>
              <Field label="日付">
                {(id) => (
                  <input
                    id={id}
                    type="date"
                    value={post.published_date ?? ""}
                    onChange={(e) =>
                      set((d) => {
                        if (e.target.value) {
                          d.post.published_date = e.target.value;
                          d.post.published_date_precision ??= "day";
                        } else {
                          delete d.post.published_date;
                          delete d.post.published_date_precision;
                        }
                      })
                    }
                  />
                )}
              </Field>
              <Field label="日付の精度">
                {(id) => (
                  <select
                    id={id}
                    value={post.published_date_precision ?? ""}
                    onChange={(e) =>
                      set((d) => {
                        const v = e.target.value as (typeof PRECISIONS)[number]["value"] | "";
                        if (v) d.post.published_date_precision = v;
                        else delete d.post.published_date_precision;
                      })
                    }
                  >
                    <option value="">未設定</option>
                    {PRECISIONS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </>
          )}
        </div>
        <Field label="URL">
          {(id) => (
            <input
              id={id}
              type="url"
              value={post.url ?? ""}
              onChange={(e) =>
                set((d) => {
                  if (e.target.value) d.post.url = e.target.value;
                  else delete d.post.url;
                })
              }
            />
          )}
        </Field>
        <div className="field-row">
          <Field label="有料かどうか" hint="未設定なら情報源の設定に従います">
            {(id) => (
              <select
                id={id}
                value={post.availability ?? ""}
                onChange={(e) =>
                  set((d) => {
                    const v = e.target.value as "free" | "paid" | "mixed" | "";
                    if (v) d.post.availability = v;
                    else delete d.post.availability;
                  })
                }
              >
                <option value="">未設定</option>
                {Object.entries(AVAILABILITY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="field">
            <span className="field-label" id="classification-label">
              公開区分
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="classification-label">
              {(["public", "private"] as const).map((c) => (
                <label key={c} className="segment">
                  <input
                    type="radio"
                    name="post-classification"
                    checked={post.classification === c}
                    onChange={() => set((d) => void (d.post.classification = c))}
                  />
                  <span>{c === "public" ? "公開" : "非公開"}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="editor-section">
        <h2>素材</h2>
        {(draft.assets ?? []).length === 0 && <p className="quiet">素材がありません。</p>}
        <ol className="asset-list">
          {(draft.assets ?? []).map((a, i) => (
            <li key={a.ref} className="asset-item">
              <p className="asset-head">
                <span>{MEDIA_LABELS[a.media_type]}</span>
                <span className="quiet">{a.ref}</span>
                {pageLabel(a.attributes) && <span>{pageLabel(a.attributes)}</span>}
              </p>
              <div className="field-row">
                <Field label="公開区分">
                  {(id) => (
                    <select
                      id={id}
                      value={a.classification ?? ""}
                      onChange={(e) =>
                        set((d) => {
                          const target = d.assets?.[i];
                          if (!target) return;
                          const v = e.target.value as "public" | "private" | "";
                          if (v) target.classification = v;
                          else delete target.classification;
                        })
                      }
                    >
                      <option value="">投稿に合わせる</option>
                      <option value="public">公開</option>
                      <option value="private">非公開</option>
                    </select>
                  )}
                </Field>
                {(a.media_type === "image" || a.media_type === "document") && (
                  <>
                    <Field label="ページ（から）">
                      {(id) => (
                        <input
                          id={id}
                          type="number"
                          min={1}
                          inputMode="numeric"
                          value={String(a.attributes?.page_from ?? "")}
                          onChange={(e) =>
                            set((d) => {
                              const t = d.assets?.[i];
                              if (t)
                                t.attributes = setAttr(
                                  t.attributes,
                                  "page_from",
                                  numberOrUndefined(e.target.value),
                                );
                            })
                          }
                        />
                      )}
                    </Field>
                    <Field label="ページ（まで）">
                      {(id) => (
                        <input
                          id={id}
                          type="number"
                          min={1}
                          inputMode="numeric"
                          value={String(a.attributes?.page_to ?? "")}
                          onChange={(e) =>
                            set((d) => {
                              const t = d.assets?.[i];
                              if (t)
                                t.attributes = setAttr(
                                  t.attributes,
                                  "page_to",
                                  numberOrUndefined(e.target.value),
                                );
                            })
                          }
                        />
                      )}
                    </Field>
                    <Field label="面の名前" hint="表紙・裏表紙など">
                      {(id) => (
                        <input
                          id={id}
                          value={String(a.attributes?.page_label ?? "")}
                          onChange={(e) =>
                            set((d) => {
                              const t = d.assets?.[i];
                              if (t)
                                t.attributes = setAttr(t.attributes, "page_label", e.target.value);
                            })
                          }
                        />
                      )}
                    </Field>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="editor-section">
        <h2>紐付け</h2>
        {(draft.links ?? []).length === 0 && <p className="quiet">紐付けがありません。</p>}
        <ul className="proposal-list">
          {(draft.links ?? []).map((l, i) => (
            <Proposal
              key={i}
              accepted={l.accepted !== false}
              warned={warned.has(`links.${i}`)}
              onToggle={(accepted) =>
                set((d) => {
                  const t = d.links?.[i];
                  if (t) t.accepted = accepted;
                })
              }
            >
              <span className="proposal-from">{fromLabel(l.from)}</span>
              <span className="proposal-role">{ROLE_LABELS[l.role] ?? l.role}</span>
              <span className="proposal-target">{labelOf(l.to_id)}</span>
              <OriginBadge p={l} />
            </Proposal>
          ))}
        </ul>
        {!readOnly && (
          <AddLink
            source={props.source}
            onAdd={(ref, role) => {
              props.onLabel(ref);
              set((d) => {
                d.links = [
                  ...(d.links ?? []),
                  {
                    from: "post",
                    to_type: ref.type,
                    to_id: ref.id,
                    role,
                    origin: "human",
                    confidence: 1,
                  },
                ];
              });
            }}
          />
        )}
      </section>

      {(draft.statements ?? []).length > 0 && (
        <section className="editor-section">
          <h2>言明</h2>
          <ul className="proposal-list">
            {(draft.statements ?? []).map((s: Statement, i) => (
              <Proposal
                key={i}
                accepted={s.accepted !== false}
                warned={warned.has(`statements.${i}`)}
                onToggle={(accepted) =>
                  set((d) => {
                    const t = d.statements?.[i];
                    if (t) t.accepted = accepted;
                  })
                }
              >
                <span className="proposal-target">{labelOf(s.subject_id)}</span>
                <span className="proposal-role">{s.property}</span>
                <input
                  aria-label="値"
                  className="proposal-value"
                  value={s.value_text ?? ""}
                  onChange={(e) =>
                    set((d) => {
                      const t = d.statements?.[i];
                      if (t) t.value_text = e.target.value;
                    })
                  }
                />
                <OriginBadge p={s} />
              </Proposal>
            ))}
          </ul>
        </section>
      )}
    </fieldset>
  );
}

function Proposal({
  accepted,
  warned,
  onToggle,
  children,
}: {
  accepted: boolean;
  warned: boolean;
  onToggle: (accepted: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <li className={`proposal ${accepted ? "" : "is-declined"} ${warned ? "is-warned" : ""}`}>
      <label className="proposal-accept">
        <input type="checkbox" checked={accepted} onChange={(e) => onToggle(e.target.checked)} />
        <span className="visually-hidden">採用する</span>
      </label>
      <span className="proposal-body">{children}</span>
      {warned && <span className="proposal-warn">確信度が低い</span>}
    </li>
  );
}

export function AddLink({
  source,
  onAdd,
  label = "紐付けを足す（人物・出来事を名前で探す）",
}: {
  source: ArchiveSource;
  onAdd: (ref: RefLabel, role: string) => void;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<string>("mentions");
  const [found, setFound] = useState<RefLabel[] | null>(null);
  const queryId = useId();
  const roleId = useId();
  const search = () => {
    void source.findRefs(query).then(setFound);
  };
  return (
    <div className="add-link">
      <div className="field-row">
        <div className="field grow">
          <label htmlFor={queryId}>{label}</label>
          <input
            id={queryId}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search();
              }
            }}
          />
        </div>
        <div className="field">
          <label htmlFor={roleId}>役割</label>
          <select id={roleId} value={role} onChange={(e) => setRole(e.target.value)}>
            {ADDABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="button" onClick={search} disabled={!query.trim()}>
          探す
        </button>
      </div>
      {found && found.length === 0 && <p className="quiet">見つかりませんでした。</p>}
      {found && found.length > 0 && (
        <ul className="ref-results">
          {found.map((r) => (
            <li key={`${r.type}:${r.id}`}>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  onAdd(r, role);
                  setFound(null);
                  setQuery("");
                }}
              >
                {r.label} を足す
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
