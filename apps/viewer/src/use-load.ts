import { useCallback, useEffect, useState } from "react";

export type Load<T> =
  { status: "loading" } | { status: "error"; error: Error } | { status: "ready"; data: T };

function sameDeps(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

/**
 * 読み込みの状態を持つ。deps が変わると「読み込み中」に戻して読み直す。reload で手動でも読み直せる。
 * refresh が変わったときは、今の中身を見せたまま裏で読み直し、読めたら差し替える（承認の後の一覧など）
 */
export function useLoad<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  refresh: unknown[] = [],
): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = [...deps, tick];

  // 条件が変わったら、描画の時点で「読み込み中」に戻す（古い結果を見せない）
  const [loadedFor, setLoadedFor] = useState(current);
  if (!sameDeps(loadedFor, current)) {
    setLoadedFor(current);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let alive = true;
    fn().then(
      (data) => alive && setState({ status: "ready", data }),
      (error: unknown) =>
        alive &&
        // 裏の読み直しに失敗したときは、今の中身を残す
        setState((prev) =>
          prev.status === "ready" && refresh.length > 0
            ? prev
            : { status: "error", error: error instanceof Error ? error : new Error(String(error)) },
        ),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 呼び出し側が deps を決める
  }, [...current, ...refresh]);
  return [state, reload];
}
