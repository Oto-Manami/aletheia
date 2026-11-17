import { useCallback, useEffect, useState } from "react";
import { peekLoad, rememberLoad } from "./load-cache.ts";

export type Load<T> =
  { status: "loading" } | { status: "error"; error: Error } | { status: "ready"; data: T };

function sameDeps(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

function initial<T>(cacheKey: string | undefined): Load<T> {
  const hit = cacheKey === undefined ? undefined : peekLoad(cacheKey);
  return hit ? { status: "ready", data: hit.data as T } : { status: "loading" };
}

/**
 * 読み込みの状態を持つ。deps が変わると「読み込み中」に戻して読み直す。reload で手動でも読み直せる。
 * refresh が変わったときは、今の中身を見せたまま裏で読み直し、読めたら差し替える（承認の後の一覧など）。
 *
 * cacheKey を渡すと、読めた中身をタブの中で覚え（決定記録 0062）、同じ鍵で開き直したときは覚えた中身を
 * すぐに見せて、裏で読み直して差し替える。鍵には、中身を決める条件（ID・絞り込みなど）をすべて含める
 */
export function useLoad<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  refresh: unknown[] = [],
  cacheKey?: string,
): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>(() => initial<T>(cacheKey));
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = [...deps, cacheKey, tick];

  // 条件が変わったら、描画の時点で「読み込み中」（覚えた中身があればそれ）に戻す（古い結果を見せない）
  const [loadedFor, setLoadedFor] = useState(current);
  if (!sameDeps(loadedFor, current)) {
    const keyChanged = !Object.is(loadedFor[loadedFor.length - 2], cacheKey);
    const depsChanged = !sameDeps(loadedFor.slice(0, -2), deps);
    setLoadedFor(current);
    // 手動の読み直し（reload）だけのときは、これまでどおり「読み込み中」に戻す
    setState(keyChanged || depsChanged ? initial<T>(cacheKey) : { status: "loading" });
  }

  useEffect(() => {
    let alive = true;
    fn().then(
      (data) => {
        if (cacheKey !== undefined) rememberLoad(cacheKey, data);
        if (alive) setState({ status: "ready", data });
      },
      (error: unknown) =>
        alive &&
        // 裏の読み直しに失敗したときは、今の中身を残す
        setState((prev) =>
          prev.status === "ready" && (refresh.length > 0 || cacheKey !== undefined)
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
