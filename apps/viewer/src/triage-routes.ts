// 振り分けの画面の分け方（設計書 決定記録 0038）。
//
// 画像を選ぶ意味がルートで違うため、ブログとニュースで画面を分ける。
// - ブログ: 「残す」と承認待ちに進む。選んだ画像は、承認の画面で確かめてから保存する
// - ニュース: 出来事に紐付けると、その場で承認まで済む。選んだ画像がそのまま保存される（決定記録 0035・0037）

export type TriageRoute = "blog" | "news";

export const TRIAGE_ROUTES: Record<
  TriageRoute,
  {
    title: string;
    nav: string;
    lead: string;
    images: string;
    empty: string;
    /** 残さないときの呼び方（ボタン・知らせ） */
    discard: string;
  }
> = {
  blog: {
    title: "ブログの振り分け",
    nav: "ブログの振り分け",
    lead: "メンバーのブログです。本人への言及があるもの・本人が写っているものを残し、それ以外は「言及なし」として確認済みにします（本文と画像は残しません。直近 10 件は戻せます）。",
    images: "選んだ画像は、承認の画面で確かめてから保存します。",
    empty: "振り分け待ちのブログはありません。",
    discard: "言及なし",
  },
  news: {
    title: "ニュースの振り分け",
    nav: "ニュースの振り分け",
    lead: "公式サイトのニュースです。本人に関係するものは出来事に紐付けて保存し、それ以外は「関係なし」として確認済みにします（直近 10 件は戻せます）。",
    images: "選んだ画像だけが、そのまま保存されます（承認の画面は通りません）。",
    empty: "振り分け待ちのニュースはありません。",
    discard: "関係なし",
  },
};

export function triageRouteOf(value: string | null | undefined): TriageRoute | null {
  return value === "blog" || value === "news" ? value : null;
}
