// 一つ上の画面へ戻るリンク
//
// - 既定: いつも出す（作品の画面 → 作品の一覧、出来事の編集 → 出来事の表示 など）
// - list: 一覧と中身を並べる画面（承認・出来事・楽曲）の「一覧に戻る」。広い画面では一覧が隣に見えて
//   いるので出さず、狭い画面（一覧と中身を切り替える）でだけ出す
// - 戻り先が決まらない画面（投稿など、いろいろな画面から開くもの）は HistoryBack を使う

import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link, type To, useLocation, useNavigate } from "react-router";

export function BackLink({
  to,
  children,
  list = false,
}: {
  to: To;
  children: ReactNode;
  list?: boolean;
}) {
  return (
    <Link className={`back-link ${list ? "back-link-list" : ""}`} to={to}>
      <ChevronLeft size={16} aria-hidden="true" />
      {children}
    </Link>
  );
}

/**
 * 開く前の画面に戻る。サイトの中から開いたときはブラウザの「戻る」と同じにし、URL を直接開いたときなど
 * 戻る先が無ければ fallback へ移る
 */
export function HistoryBack({ fallback, label }: { fallback: To; label: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  // 最初に開いた画面は key が "default" になる（サイトの中で移ってきたのではない）
  const inApp = location.key !== "default";
  if (!inApp) return <BackLink to={fallback}>{label}</BackLink>;
  return (
    <button type="button" className="back-link link-button" onClick={() => void navigate(-1)}>
      <ChevronLeft size={16} aria-hidden="true" />
      戻る
    </button>
  );
}
