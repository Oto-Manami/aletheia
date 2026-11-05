// 作品・相手を名前で探して選ぶ。見つからなければ、その場で作る（設計書 決定記録 0027）

import { Plus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useApp } from "../context.tsx";
import { ENTITY_SUBTYPE_LABELS } from "../format.ts";
import type { Classification, EditableEntityType, EntityOption } from "../source/types.ts";

export interface Picked {
  id: string;
  label: string;
}

/** 入力が落ち着いてから探す */
export function useSearch<T>(query: string, search: (q: string) => Promise<T[]>, delayMs = 250) {
  // 結果は、どの問い合わせの結果かと組で持つ（入力が変わったら古い結果は見せない）
  const [found, setFound] = useState<{ q: string; rows: T[] } | null>(null);
  const q = query.trim();
  useEffect(() => {
    if (!q) return;
    let live = true;
    const timer = setTimeout(() => {
      search(q)
        .then((rows) => live && setFound({ q, rows }))
        .catch(() => live && setFound({ q, rows: [] }));
    }, delayMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // search は呼び出し側で毎回作られるため、問い合わせの文字だけで探し直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, delayMs]);
  return q && found?.q === q ? found.rows : null;
}

/** 選んだもの（外せる） */
export function PickedChip({
  label,
  onClear,
  clearLabel,
}: {
  label: string;
  onClear: () => void;
  clearLabel: string;
}) {
  return (
    <span className="picked">
      <span className="picked-label">{label}</span>
      <button type="button" className="picked-clear" aria-label={clearLabel} onClick={onClear}>
        <X size={14} aria-hidden="true" />
      </button>
    </span>
  );
}

export function EntityPicker({
  label,
  types,
  createType,
  defaultSubtype,
  value,
  onChange,
  exclude = [],
  placeholder,
  addMode = false,
}: {
  label: string;
  /** 探す種類 */
  types: readonly string[];
  /** 見つからないときに作る種類 */
  createType: EditableEntityType;
  defaultSubtype: string | null;
  value: Picked | null;
  onChange: (picked: Picked | null) => void;
  exclude?: string[];
  placeholder?: string;
  /** 選んだら入力を空に戻す（出演者を足していくとき） */
  addMode?: boolean;
}) {
  const { source } = useApp();
  const id = useId();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [subtype, setSubtype] = useState(defaultSubtype ?? "");
  const [classification, setClassification] = useState<Classification | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const found = useSearch<EntityOption>(query, (q) => source.findEntities(q, types));
  const options = (found ?? []).filter((o) => !exclude.includes(o.id));
  const subtypes = ENTITY_SUBTYPE_LABELS[createType] ?? {};

  const pick = (picked: Picked) => {
    onChange(picked);
    setQuery("");
    setCreating(false);
    setClassification(null);
  };

  if (value && !addMode) {
    return (
      <div className="field">
        <span className="field-label">{label}</span>
        <div>
          <PickedChip
            label={value.label}
            clearLabel={`${label}を外す`}
            onClear={() => onChange(null)}
          />
        </div>
      </div>
    );
  }

  const exact = options.some((o) => o.label.replace(/\s/g, "") === query.trim().replace(/\s/g, ""));

  return (
    <div className="field picker">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="search"
        value={query}
        placeholder={placeholder ?? "名前で探す"}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setCreating(false);
          setMessage(null);
        }}
      />
      {message && (
        <p className="field-hint" role="status">
          {message}
        </p>
      )}
      {query.trim() && found && !creating && (
        <ul className="picker-results" aria-label={`${label}の候補`}>
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="picker-option"
                onClick={() => pick({ id: o.id, label: o.label })}
              >
                <span>{o.label}</span>
                {o.subtype && subtypes[o.subtype] && (
                  <span className="quiet">{subtypes[o.subtype]}</span>
                )}
              </button>
            </li>
          ))}
          {!exact && (
            <li>
              <button
                type="button"
                className="picker-option is-create"
                onClick={() => {
                  // 作る種類の初めの値は、開いた時点の出来事の種類に合わせる
                  setSubtype(defaultSubtype ?? "");
                  setCreating(true);
                }}
              >
                <Plus size={14} aria-hidden="true" />
                <span>「{query.trim()}」を新しく作る</span>
              </button>
            </li>
          )}
        </ul>
      )}
      {creating && (
        <div className="picker-create" role="group" aria-label={`「${query.trim()}」を作る`}>
          <p className="picker-create-title">「{query.trim()}」を新しく作る</p>
          <div className="field-row">
            {Object.keys(subtypes).length > 0 && (
              <div className="field">
                <label htmlFor={`${id}-subtype`}>種類</label>
                <select
                  id={`${id}-subtype`}
                  value={subtype}
                  onChange={(e) => setSubtype(e.target.value)}
                >
                  {Object.entries(subtypes).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <ClassificationChoice
              name={`${id}-classification`}
              value={classification}
              onChange={setClassification}
            />
          </div>
          <div className="picker-create-actions">
            <button type="button" className="button" onClick={() => setCreating(false)}>
              やめる
            </button>
            <button
              type="button"
              className="button primary"
              disabled={!classification || busy}
              onClick={() => {
                if (!classification) return;
                setBusy(true);
                source
                  .createEntity({
                    type: createType,
                    subtype: subtype || null,
                    name: query.trim(),
                    classification,
                  })
                  .then((r) => {
                    pick({ id: r.id, label: r.label });
                    setMessage(
                      r.created ? null : `同じ名前の「${r.label}」があったので、それを選びました`,
                    );
                  })
                  .catch((e: unknown) => setMessage(e instanceof Error ? e.message : String(e)))
                  .finally(() => setBusy(false));
              }}
            >
              作って選ぶ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 公開区分（既定を置かず、選ばせる） */
export function ClassificationChoice({
  name,
  value,
  onChange,
}: {
  name: string;
  value: Classification | null;
  onChange: (value: Classification) => void;
}) {
  return (
    <div className="field">
      <span className="field-label" id={`${name}-label`}>
        公開区分
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={`${name}-label`}>
        {(
          [
            ["public", "公開"],
            ["private", "非公開"],
          ] as const
        ).map(([v, l]) => (
          <label key={v} className="segment">
            <input
              type="radio"
              name={name}
              value={v}
              checked={value === v}
              onChange={() => onChange(v)}
            />
            <span>{l}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
