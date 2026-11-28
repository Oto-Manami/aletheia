// 出来事の題名から、作品の名前（号・回の印を外した名前）と回・号の番号を読む（設計書 決定記録 0080）
//
// 同じ雑誌の号・同じ番組の回は、題名から号・回の印を外すとほぼ同じ名前になる。その名前でまとめて、
// 作品にまとめる候補にする。規則だけで読む（AI は使わない）。人物・情報源の名前は持たない。
//
// 例:
// - 「見本誌」2026年11月号 → 見本誌
// - 「見本誌」vol.363 → 見本誌（番号 363）
// - 「見本週刊」2026年9号 → 見本週刊（番号 9）
// - 「見本の練習」～曲の名前～ → 見本の練習
// - 見本の音楽祭 2026 初夏 → 見本の音楽祭
// - 見本ラジオ 第 12 回 → 見本ラジオ（番号 12）
// 末尾の数字だけ（見本番組02 など）は名前の一部なので外さない。

const SEASON = "(?:初夏|盛夏|新春|晩秋|春|夏|秋|冬)";
const YEAR = "(?:(?:19|20)\\d{2}\\s*年?\\s*)";

/**
 * 末尾の号・回の印。number が true のものは、最初の括弧が回・号の番号。outer が true のものは、
 * かぎ括弧の外にあるときだけ外す（「見本誌 SUMMER 2025」のような特別号の名前の年は名前の一部）
 */
const MARKERS: { re: RegExp; number: boolean; outer?: boolean }[] = [
  // 第 12 回・第 3 話・第 5 号
  { re: /\s*第\s*(\d+)\s*(?:回|話|号|夜)$/, number: true },
  // #368
  { re: /\s*#\s*(\d+)$/, number: true },
  // No.49・vol.363
  { re: /\s*(?:no|vol)\.?\s*(\d+)$/i, number: true },
  // 2026年11月号・5月号・3・4月合併号（月は番号にしない）
  {
    re: new RegExp(
      `\\s*${YEAR}?\\d{1,2}(?:\\s*月)?(?:\\s*[・-]\\s*\\d{1,2})?\\s*月\\s*(?:合併)?号$`,
    ),
    number: false,
  },
  // 2026年9号・34号・3・4合併号
  {
    re: new RegExp(`\\s*${YEAR}?(\\d{1,3})\\s*(?:[・-]\\s*\\d{1,3}\\s*)?(?:合併)?号$`),
    number: true,
  },
  // 2025年秋号・夏号
  { re: new RegExp(`\\s*${YEAR}?${SEASON}\\s*号$`), number: false },
  // ～副題～（NFKC で全角の波線は ~ になる）
  { re: /\s*[〜~][^〜~]+[〜~]$/, number: false },
  // 末尾の年（毎年の特番。見本の音楽祭 2026・2026 初夏）
  {
    re: new RegExp(`\\s*(?:19|20)\\d{2}(?:\\s*年)?(?:\\s*${SEASON})?$`),
    number: false,
    outer: true,
  },
];

/**
 * 題名から作品の名前と回・号の番号を読む。名前は NFKC で整える。「名前」だけが残れば括弧を外す
 */
export function titleStem(title: string): { stem: string; number: number | null } {
  let number: number | null = null;
  const strip = (text: string, inner: boolean): string => {
    let s = text;
    for (let changed = true; changed;) {
      changed = false;
      for (const m of MARKERS) {
        if (inner && m.outer) continue;
        const hit = m.re.exec(s);
        // 題名がすべて印のときは外さない
        if (!hit || hit.index === 0) continue;
        if (m.number && number === null) number = Number(hit[1]);
        s = s.slice(0, hit.index).trim();
        changed = true;
      }
    }
    return s;
  };
  let s = strip(title.normalize("NFKC").replace(/\s+/g, " ").trim(), false);
  const quoted = /^[「『](.+)[」』]$/.exec(s);
  if (quoted && !/[「『」』]/.test(quoted[1]!)) s = strip(quoted[1]!.trim(), true);
  return { stem: s, number };
}

/** 名前を比べるための鍵（全角・半角、空白、大文字・小文字、かぎ括弧の違いを吸収する） */
export function nameKey(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s「」『』【】"“”]/g, "");
}

/**
 * 作品の名前から、題名と比べる鍵。正式な名前・別名と、名前の中のかぎ括弧の中身（見本局ドラマ「見本」の「見本」）。
 * 2 文字に満たないものは使わない
 */
export function workKeys(name: string, aliases: readonly string[] = []): string[] {
  const inner = [...name.normalize("NFKC").matchAll(/[「『]([^」』]+)[」』]/g)].map((m) => m[1]!);
  return [...new Set([name, ...aliases, ...inner].map(nameKey))].filter((k) => k.length >= 2);
}

// ---------------------------------------------------------------------------
// 作品にまとめる候補（設計書 決定記録 0080）。API の /work-grouping と、閲覧サイトのデモ版で使う

/** 号として数える作品の種類（それ以外は番組の回。閲覧サイトの source/regular.ts と同じ） */
const PUBLICATION_SUBTYPES = new Set(["magazine", "series", "book", "photobook"]);

/** 名前でまとめる出来事の種類 */
const EPISODE_KINDS = new Set(["episode", "publication"]);

/** 候補にする作品（楽曲・シングルなどは除いて渡す） */
export interface GroupingWork {
  id: string;
  name: string;
  subtype: string | null;
  aliases: readonly string[];
  regular: boolean;
}

/** 作品を指していない出来事（日程と、作品にまとめない印のものは除いて渡す） */
export interface GroupingSource {
  id: string;
  title: string | null;
  kind: string;
  starts_on: string | null;
  date_precision: string | null;
  episode_number: number | null;
  /** 出来事に紐付いた素材（告知のニュースなど）の文字。作品の名前を探す（決定記録 0082） */
  material_text?: string | null;
}

export interface GroupedEvent extends Omit<GroupingSource, "material_text"> {
  /** 題名から読んだ回・号の番号（付けるとき、番号が空なら入れる） */
  number: number | null;
  /**
   * stem: 名前が同じ（初めから選ぶ）。material: 紐付いた素材の文字に作品の名前がある（初めは選ばない。
   * 決定記録 0082）。title: 題名に作品の名前を含む（初めは選ばない）
   */
  match: "stem" | "material" | "title";
}

export interface WorkGroup {
  /** work:<作品の ID> か stem:<出来事の種類>:<名前の鍵> */
  key: string;
  /** まとめる名前（作品があれば作品の名前、無ければ題名から読んだ名前） */
  name: string;
  work: { id: string; name: string; subtype: string | null; regular: boolean } | null;
  /** 作品を作るときの種類の初めの値（掲載は雑誌。番組の回は選んでもらう） */
  subtype: string | null;
  events: GroupedEvent[];
}

/** 出来事の種類と作品の種類を組み合わせてよいか（掲載は雑誌など、番組の回はそれ以外） */
export function fitsWork(kind: string, subtype: string | null): boolean {
  if (kind === "publication") return PUBLICATION_SUBTYPES.has(subtype ?? "");
  if (kind === "episode") return !PUBLICATION_SUBTYPES.has(subtype ?? "");
  return true;
}

/**
 * 出来事を、まとめる候補ごとに分ける。
 * - 番組の回・掲載: 題名から読んだ名前が作品の名前・別名と同じなら、その作品（初めから選ぶ）。違えば同じ名前どうし
 * - 紐付いた素材の文字に作品の名前・別名があれば、その作品の候補（初めは選ばない。決定記録 0082）
 * - どの種類でも、題名に作品の名前・別名を含むものは、その作品の候補（初めは選ばない。いちばん長い名前で合うもの）
 * 並びは、既にある作品 → 同じ名前が 2 件以上 → 1 件だけ。同じ段は件数の多い順・新しい順
 */
export function groupForWorks(
  events: readonly GroupingSource[],
  works: readonly GroupingWork[],
): WorkGroup[] {
  const keyed = works.map((w) => ({ work: w, keys: workKeys(w.name, w.aliases) }));
  const groups = new Map<string, WorkGroup>();
  const add = (key: string, init: () => Omit<WorkGroup, "events">, event: GroupedEvent) => {
    let g = groups.get(key);
    if (!g) {
      g = { ...init(), events: [] };
      groups.set(key, g);
    }
    g.events.push(event);
  };
  for (const e of events) {
    const title = e.title ?? "";
    const { stem, number } = titleStem(title);
    const stemK = nameKey(stem);
    const titleK = nameKey(title);
    const materialK = nameKey(e.material_text ?? "");
    const base = {
      id: e.id,
      title: e.title,
      kind: e.kind,
      starts_on: e.starts_on,
      date_precision: e.date_precision,
      episode_number: e.episode_number,
      number,
    };
    const candidates = keyed.filter(({ work }) => fitsWork(e.kind, work.subtype));
    const exact = EPISODE_KINDS.has(e.kind)
      ? candidates.find(({ keys }) => keys.includes(stemK))
      : undefined;
    const inTitle = candidates.filter(({ keys }) => keys.some((k) => titleK.includes(k)));
    const contained = exact
      ? undefined
      : inTitle
          .map(({ work, keys }) => ({
            work,
            length: Math.max(0, ...keys.filter((k) => titleK.includes(k)).map((k) => k.length)),
          }))
          .sort((a, b) => b.length - a.length)[0];
    // 紐付いた素材（告知のニュースなど）に名前のある作品。配信の動画は、告知に配信したチャンネルの名前が
    // あることが多い。2 つ以上あれば、題名に名前の無いものが 1 つのときだけ使う（題名に名前のある作品は、
    // その回の話題であることが多い。決定記録 0082）
    const inMaterial = exact
      ? []
      : candidates.filter(({ keys }) => materialK && keys.some((k) => materialK.includes(k)));
    const fromMaterial =
      inMaterial.length === 1
        ? inMaterial[0]
        : (() => {
            const notInTitle = inMaterial.filter((c) => !inTitle.includes(c));
            return notInTitle.length === 1 ? notInTitle[0] : undefined;
          })();
    const work = exact?.work ?? fromMaterial?.work ?? contained?.work;
    if (work) {
      add(
        `work:${work.id}`,
        () => ({
          key: `work:${work.id}`,
          name: work.name,
          work: { id: work.id, name: work.name, subtype: work.subtype, regular: work.regular },
          subtype: work.subtype,
        }),
        { ...base, match: exact ? "stem" : fromMaterial ? "material" : "title" },
      );
    } else if (EPISODE_KINDS.has(e.kind) && stemK) {
      add(
        `stem:${e.kind}:${stemK}`,
        () => ({
          key: `stem:${e.kind}:${stemK}`,
          name: stem,
          work: null,
          subtype: e.kind === "publication" ? "magazine" : null,
        }),
        { ...base, match: "stem" },
      );
    }
  }
  const latest = (g: WorkGroup) =>
    g.events.reduce((m, e) => ((e.starts_on ?? "") > m ? (e.starts_on ?? "") : m), "");
  const tier = (g: WorkGroup) => (g.work ? 0 : g.events.length > 1 ? 1 : 2);
  return [...groups.values()].sort(
    (a, b) =>
      tier(a) - tier(b) ||
      b.events.length - a.events.length ||
      latest(b).localeCompare(latest(a)) ||
      a.name.localeCompare(b.name, "ja"),
  );
}
