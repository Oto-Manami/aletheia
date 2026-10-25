// 招待リンク（設計書 決定記録 0019）
//
// リンクは /invite#<値>。値は URL の # 以降に置き、ホスティングのアクセスの記録に残らないようにする。
// Discord でのログインを挟むため、開いた時点で値をタブの中（sessionStorage）に預け、URL からは消す。

const KEY = "aletheia.invite";
const TOKEN = /^[0-9a-f]{64}$/;

export function inviteUrl(origin: string, token: string): string {
  return `${origin}/invite#${token}`;
}

/** 招待リンクで開かれたら、値を預けて URL から消す。起動時に一度呼ぶ */
export function captureInvite(
  loc: Location = window.location,
  history: History = window.history,
): void {
  if (loc.pathname !== "/invite") return;
  const token = loc.hash.replace(/^#/, "");
  if (!TOKEN.test(token)) return;
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    // 預けられない環境では、招待を受けられない（画面で案内する）
  }
  history.replaceState(null, "", "/invite");
}

export function pendingInvite(): string | null {
  try {
    const token = sessionStorage.getItem(KEY);
    return token && TOKEN.test(token) ? token : null;
  } catch {
    return null;
  }
}

export function clearInvite(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // 何もしない
  }
}

/** データベースが返す招待の失敗の理由 → 画面に出す文 */
export const INVITE_ERRORS: Record<string, string> = {
  invite_invalid: "招待リンクが正しくありません。リンクを全部コピーできているか確かめてください。",
  invite_used: "この招待リンクはもう使われています。運営者に新しいリンクを頼んでください。",
  invite_revoked: "この招待リンクは取り消されています。運営者に確かめてください。",
  invite_expired:
    "この招待リンクは期限（7 日）が切れています。運営者に新しいリンクを頼んでください。",
};
