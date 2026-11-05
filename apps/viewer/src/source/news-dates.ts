// 公式サイトのニュースの題名・本文に出てくる日付を、規則で拾う
//
// 振り分けの画面で、紐付ける出来事の候補（日付の近い出来事）を探すのに使う。出来事の題名・種類などは
// ニュースから入れず、出来事の画面で人が作る（設計書 決定記録 0030）。AI は使わない（決定記録 0011）。

const DATE = /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/g;

/** 題名・本文に出てくる日付（JST の暦日。重なりなし・出てくる順） */
export function newsDates(news: {
  title: string;
  body: string;
  /** ニュースの日付（JST の暦日） */
  publishedDate: string | null;
}): string[] {
  const text = `${news.title}\n${news.body}`;
  const [baseYear, baseMonth] = (news.publishedDate ?? "").split("-").map(Number);
  const dates: string[] = [];
  // 「本日」が日付より前に出てくるときは、ニュースの日付のこと
  const today = text.search(/本日/);
  const firstDate = text.search(/\d{1,2}月\d{1,2}日/);
  if (news.publishedDate && today >= 0 && (firstDate < 0 || today < firstDate)) {
    dates.push(news.publishedDate);
  }
  for (const m of text.matchAll(DATE)) {
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    let year = m[1] ? Number(m[1]) : baseYear;
    if (!year) continue;
    // 年の書いていない日付は、ニュースの日付より大きく前なら翌年のこととみなす（12 月のニュースの 1 月の話など）
    if (!m[1] && baseMonth && month < baseMonth - 3) year += 1;
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!dates.includes(date)) dates.push(date);
  }
  return dates;
}
