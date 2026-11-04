import { useId } from "react";
import type { RefLabel } from "../source/types.ts";

/** タグ付けの候補から 1 人を選ぶ（選んだらすぐ足す） */
export function PersonSelect({
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
        <option value="">＋ 人を足す</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </span>
  );
}
