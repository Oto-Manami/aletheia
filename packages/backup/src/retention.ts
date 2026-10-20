// Drive に残すバックアップの選び方（設計書 決定記録 0016）
// 直近 30 日分と、各月の 1 日の分を残す。日付の名前でないフォルダには触れない

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' から n 日前の 'YYYY-MM-DD'（暦の上の計算。時差の影響を受けない） */
export function daysBefore(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** 消してよいフォルダの名前を返す。today は JST の日付 */
export function expiredBackups(names: readonly string[], today: string, keepDays = 30): string[] {
  const oldest = daysBefore(today, keepDays - 1);
  return names.filter(
    (name) =>
      DATE.test(name) &&
      !Number.isNaN(Date.parse(`${name}T00:00:00Z`)) &&
      name < oldest &&
      !name.endsWith("-01"),
  );
}

/** いまの JST の日付 */
export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
