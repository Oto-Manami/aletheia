// 公式サイトのニュースから、出来事の初めの値を規則で作る（設計書 決定記録 0029）
//
// 規則で決めるのは初めの値だけで、人が直してから作る。AI は使わない（決定記録 0011）。

export interface NewsPrefill {
  kind: string;
  title: string;
  /** 題名・本文に最初に出てくる日付（JST の暦日）。無ければ null */
  date: string | null;
  /** その日付のすぐ後ろの時刻（HH:MM）。無ければ null */
  time: string | null;
  /** 題名・本文に出てくる日付（重なりなし・出てくる順） */
  dates: string[];
}

const PUBLICATION = /雑誌|号|掲載|表紙|グラビア|誌面|写真集|連載|Web|WEB|インタビュー/;
const LIVE = /ライブ|LIVE|公演|ツアー|TOUR/;

/** カテゴリ（記号・表示名）と本文の語から、出来事の種類を決める */
export function kindOfNews(code: string | null, category: string | null, text: string): string {
  const c = code ?? "";
  if (c === "media" || category === "メディア") {
    if (PUBLICATION.test(text) && !/テレビ|ラジオ|TV|放送|配信/.test(text)) return "publication";
    return "episode";
  }
  if (c === "event" || category === "イベント") return LIVE.test(text) ? "live" : "event";
  if (c === "shakehands" || category === "ミート＆グリート") return "meet_greet";
  if (c === "release" || category === "リリース") return "release";
  if (c === "ticket" || category === "チケット") return LIVE.test(text) ? "live" : "event";
  if (c === "audition" || category === "オーディション") return "announcement";
  return "other";
}

const DATE =
  /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日(?:\s*[（(][^）)]{1,3}[）)])?\s*(?:(\d{1,2}):(\d{2}))?/g;

/** 題名の頭の「11月8日(日)7:30〜」を外す（日付と時刻は別の欄に入れる） */
export function titleWithoutDate(title: string): string {
  const stripped = title
    .replace(
      /^\s*(?:\d{4}年)?\d{1,2}月\d{1,2}日(?:\s*[（(][^）)]{1,3}[）)])?\s*(?:\d{1,2}:\d{2})?\s*[〜~～-]?\s*/,
      "",
    )
    .trim();
  return stripped || title.trim();
}

export function newsPrefill(news: {
  title: string;
  body: string;
  /** ニュースの日付（JST の暦日） */
  publishedDate: string | null;
  category: string | null;
  categoryCode: string | null;
}): NewsPrefill {
  const text = `${news.title}\n${news.body}`;
  const [baseYear, baseMonth] = (news.publishedDate ?? "").split("-").map(Number);
  const dates: string[] = [];
  let firstTime: string | null = null;
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
    // 最初の日付の時刻（題名に日付だけ、本文に時刻まで、ということが多いので、同じ日付の後の出現も見る）
    if (!firstTime && date === dates[0] && m[4] && m[5]) {
      firstTime = `${m[4].padStart(2, "0")}:${m[5]}`;
    }
  }
  return {
    kind: kindOfNews(news.categoryCode, news.category, text),
    title: titleWithoutDate(news.title),
    date: dates[0] ?? null,
    time: firstTime,
    dates,
  };
}
