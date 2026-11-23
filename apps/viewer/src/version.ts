// 閲覧サイトの新しい版に気づく（Issue #73）
//
// 閲覧サイトは 1 ページのアプリなので、開いたままのタブは、新しい版が出ても古いプログラムのまま動く。
// API は自動で新しくなるため、古い画面と新しい API の組み合わせで操作すると、想定と違う結果になりうる。
// - ビルドのたびに版の印（コミットの ID）を version.json に書き、画面に戻ってきたとき・5 分ごとに見比べる
// - 違っていたら「新しい版があります」と出す。入力の途中のものを失わないよう、勝手には読み直さない
// - 古い版のまま API に書き込もうとしたら、送らずに止めて、読み直すよう知らせる
// 手元の開発・デモ版・テストでは見比べない（版の印が無い）

declare const __APP_VERSION__: string | undefined;

/** この画面のプログラムの版の印（本番のビルドだけ。それ以外は null） */
export const APP_VERSION: string | null =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__ !== "" ? __APP_VERSION__ : null;

/** 見比べる間隔 */
const POLL_MS = 5 * 60 * 1000;
/** 書き込みの前に見比べ直すまでの間隔（直前に見比べていれば、もう一度は問い合わせない） */
const FRESH_MS = 60 * 1000;

type Listener = (newer: boolean) => void;

export interface VersionWatcher {
  /** 新しい版が出ているか（分かった時点の値） */
  readonly newer: boolean;
  /** 版を問い合わせて見比べる。問い合わせに失敗したときは、分からないので今の値のまま */
  check(): Promise<boolean>;
  /** 書き込みの前: 新しい版が出ていれば、送らずに止める */
  assertCurrent(): Promise<void>;
  subscribe(listener: Listener): () => void;
}

export class StaleVersionError extends Error {
  constructor() {
    super(
      "閲覧サイトの新しい版が出ています。この画面は古い版のままなので、送らずに止めました。入力の途中のものを控えてから、読み直してもう一度操作してください",
    );
    this.name = "StaleVersionError";
  }
}

export function createVersionWatcher(options: {
  current: string | null;
  fetch?: typeof fetch;
  now?: () => number;
  url?: string;
}): VersionWatcher {
  const fetchImpl = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.now ?? Date.now;
  const url = options.url ?? "/version.json";
  const listeners = new Set<Listener>();
  let newer = false;
  let checkedAt = -Infinity;
  let pending: Promise<boolean> | null = null;

  const check = (): Promise<boolean> => {
    if (options.current === null) return Promise.resolve(false);
    pending ??= (async () => {
      try {
        const res = await fetchImpl(`${url}?t=${now()}`, { cache: "no-store" });
        if (!res.ok) return newer;
        const body = (await res.json()) as { version?: unknown };
        checkedAt = now();
        const found = typeof body.version === "string" && body.version !== options.current;
        if (found && !newer) {
          newer = true;
          for (const l of listeners) l(true);
        }
        return newer;
      } catch {
        return newer;
      } finally {
        pending = null;
      }
    })();
    return pending;
  };

  return {
    get newer() {
      return newer;
    },
    check,
    async assertCurrent() {
      if (options.current === null) return;
      if (!newer && now() - checkedAt > FRESH_MS) await check();
      if (newer) throw new StaleVersionError();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** 画面全体で 1 つ。本番のビルドだけ見比べる */
export const versionWatcher = createVersionWatcher({ current: APP_VERSION });

/** 画面に戻ってきたとき・5 分ごとに見比べる（本番のビルドだけ） */
export function startVersionPolling(watcher: VersionWatcher = versionWatcher): () => void {
  if (APP_VERSION === null) return () => undefined;
  const onVisible = () => {
    if (document.visibilityState === "visible") void watcher.check();
  };
  const timer = window.setInterval(() => void watcher.check(), POLL_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
  };
}
