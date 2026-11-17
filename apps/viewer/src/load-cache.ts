// 一度読んだ画面のデータを、タブを開いている間だけ覚える（設計書 決定記録 0062）
//
// - メモリにだけ持つ。ブラウザの保存領域（localStorage・IndexedDB など）には書かない（非公開の情報を端末に残さない）
// - 変更（承認・保存など）をしたら、すべて捨てる。ログアウト・利用者が替わったときも捨てる
// - 覚える数には上限を置き、古いものから捨てる

const LIMIT = 100;
const entries = new Map<string, unknown>();

export function peekLoad(key: string): { data: unknown } | undefined {
  if (!entries.has(key)) return undefined;
  const data = entries.get(key);
  // 使ったものを新しい側へ
  entries.delete(key);
  entries.set(key, data);
  return { data };
}

export function rememberLoad(key: string, data: unknown): void {
  entries.delete(key);
  entries.set(key, data);
  while (entries.size > LIMIT) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

export function clearLoadCache(): void {
  entries.clear();
}
