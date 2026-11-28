// 承認の画面のタグ付け: 投稿に登場する人（mentioned）と、写真に写っている人（appears）
//
// 規則が付けた候補は残したまま「採用する／しない」（accepted）を切り替え、人が足したものは人の判断
// （origin = human・確信度 1）として記録する。外した人の手で足したものは、下書きから取り除く。

import type { DraftInput } from "@aletheia/intake/draft";

type Link = NonNullable<DraftInput["links"]>[number];

const isPostLink = (l: Link) => l.from === "post";
const isAssetLink = (l: Link, ref: string) => typeof l.from === "object" && l.from.asset === ref;

/** 投稿の発信者（author）の人物 */
export function authorsOf(draft: DraftInput): string[] {
  return (draft.links ?? [])
    .filter((l) => isPostLink(l) && l.role === "author" && l.to_type === "entity")
    .map((l) => l.to_id);
}

/**
 * 書いた人が、情報源の持ち主 1 人だけになっているか（トーク。決定記録 0068）。採用しないことにした
 * 紐付けは数えない（API の承認の確かめと同じ）
 */
export function hasOnlyAuthor(draft: DraftInput, ownerId: string): boolean {
  const authors = new Set(
    (draft.links ?? [])
      .filter((l) => isPostLink(l) && l.role === "author" && l.accepted !== false)
      .map((l) => `${l.to_type}:${l.to_id}`),
  );
  return authors.size === 1 && authors.has(`entity:${ownerId}`);
}

/** 書いた人を、情報源の持ち主 1 人にする（取り込みの規則が付けるものと同じ形で付け直す） */
export function setOnlyAuthor(draft: DraftInput, ownerId: string): DraftInput {
  return {
    ...draft,
    links: [
      ...(draft.links ?? []).filter((l) => !(isPostLink(l) && l.role === "author")),
      {
        from: "post",
        to_type: "entity",
        to_id: ownerId,
        role: "author",
        origin: "rule",
        confidence: 1,
        accepted: true,
        evidence: { rule: "channel_owner" },
      },
    ],
  };
}

/** 投稿に登場する人（mentioned）。採用しないことにしたものも含む */
export function mentionsOf(draft: DraftInput): { id: string; on: boolean; rule: boolean }[] {
  return (draft.links ?? [])
    .filter((l) => isPostLink(l) && l.role === "mentioned" && l.to_type === "entity")
    .map((l) => ({ id: l.to_id, on: l.accepted !== false, rule: l.origin !== "human" }));
}

/** 写真に写っていると採用している人 */
export function appearsOf(draft: DraftInput, ref: string): string[] {
  return (draft.links ?? [])
    .filter(
      (l) =>
        isAssetLink(l, ref) &&
        l.role === "appears" &&
        l.to_type === "entity" &&
        l.accepted !== false,
    )
    .map((l) => l.to_id);
}

/** 写っている人を付ける素材（ref）。写真と動画（動画は表紙の画像で並べる。決定記録 0057） */
export function imageRefsOf(draft: DraftInput): string[] {
  return (draft.assets ?? [])
    .filter((a) => a.media_type === "image" || a.media_type === "video")
    .map((a) => a.ref);
}

function setLink(
  draft: DraftInput,
  from: "post" | { asset: string },
  role: "mentioned" | "appears" | "series" | "photographer",
  entityId: string,
  on: boolean,
): DraftInput {
  const links = [...(draft.links ?? [])];
  const same = (l: Link) =>
    l.role === role &&
    l.to_type === "entity" &&
    l.to_id === entityId &&
    (from === "post" ? isPostLink(l) : isAssetLink(l, from.asset));
  const index = links.findIndex(same);
  const existing = index >= 0 ? links[index] : undefined;
  if (!existing) {
    if (on) {
      links.push({
        from,
        to_type: "entity",
        to_id: entityId,
        role,
        origin: "human",
        confidence: 1,
      });
    }
    return { ...draft, links };
  }
  if (existing.origin === "human" && !on) {
    // 人が足したものを外すときは、記録に残さず取り除く
    links.splice(index, 1);
  } else {
    // 規則の候補は残し、人の判断として採用・不採用を記録する
    links[index] = {
      ...existing,
      accepted: on,
      ...(on && existing.origin !== "human" ? { origin: "human" as const, confidence: 1 } : {}),
      evidence: { ...existing.evidence, reviewed: true },
    };
  }
  return { ...draft, links };
}

/** 投稿に登場する人を採用する・外す */
export function setMention(draft: DraftInput, entityId: string, on: boolean): DraftInput {
  return setLink(draft, "post", "mentioned", entityId, on);
}

/** 写真に写っている人を付ける・外す */
export function setAppears(
  draft: DraftInput,
  ref: string,
  entityId: string,
  on: boolean,
): DraftInput {
  return setLink(draft, { asset: ref }, "appears", entityId, on);
}

/** すべての写真に、その人を写っているとして付ける（本人のブログなど） */
export function setAppearsAll(draft: DraftInput, entityId: string, on: boolean): DraftInput {
  return imageRefsOf(draft).reduce((d, ref) => setAppears(d, ref, entityId, on), draft);
}

// ---------------------------------------------------------------- シリーズと撮影した人（決定記録 0064）

function assetTargets(draft: DraftInput, ref: string, role: string): string[] {
  return (draft.links ?? [])
    .filter(
      (l) =>
        isAssetLink(l, ref) && l.role === role && l.to_type === "entity" && l.accepted !== false,
    )
    .map((l) => l.to_id);
}

/** 下書きのどれかの写真に付いているシリーズ（付けた順） */
export function seriesOf(draft: DraftInput): string[] {
  const ids = (draft.links ?? [])
    .filter(
      (l) =>
        typeof l.from === "object" &&
        l.role === "series" &&
        l.to_type === "entity" &&
        l.accepted !== false,
    )
    .map((l) => l.to_id);
  return [...new Set(ids)];
}

/** その写真が入っているシリーズ */
export function seriesOfAsset(draft: DraftInput, ref: string): string[] {
  return assetTargets(draft, ref, "series");
}

/** 写真をシリーズに入れる・外す */
export function setSeries(
  draft: DraftInput,
  ref: string,
  seriesId: string,
  on: boolean,
): DraftInput {
  return setLink(draft, { asset: ref }, "series", seriesId, on);
}

/** すべての写真・動画を、シリーズに入れる・外す */
export function setSeriesAll(draft: DraftInput, seriesId: string, on: boolean): DraftInput {
  return imageRefsOf(draft).reduce((d, ref) => setSeries(d, ref, seriesId, on), draft);
}

/** その写真を撮影した人 */
export function photographersOf(draft: DraftInput, ref: string): string[] {
  return assetTargets(draft, ref, "photographer");
}

/** 写真を撮影した人を付ける・外す */
export function setPhotographer(
  draft: DraftInput,
  ref: string,
  personId: string,
  on: boolean,
): DraftInput {
  return setLink(draft, { asset: ref }, "photographer", personId, on);
}

/**
 * 承認するときに、画面で見せたタグ付け（写っている人・登場する人）を人の判断として記録する。
 * 規則の候補のうち、付けたままのものは人が確かめたものに、外したものは外したと確かめたものにする
 */
export function confirmPeopleTags(draft: DraftInput): DraftInput {
  return {
    ...draft,
    links: (draft.links ?? []).map((l) => {
      const people =
        l.to_type === "entity" &&
        ((l.role === "mentioned" && isPostLink(l)) ||
          (l.role === "appears" && typeof l.from === "object"));
      if (!people || l.origin === "human" || l.evidence?.["reviewed"] === true) return l;
      const on = l.accepted !== false;
      return {
        ...l,
        accepted: on,
        ...(on ? { origin: "human" as const, confidence: 1 } : {}),
        evidence: { ...l.evidence, reviewed: true },
      };
    }),
  };
}

/** 出来事への紐付けの役割。about は告知・記録、part_of はその回の本体（映像・誌面など。決定記録 0083） */
const EVENT_ROLES = new Set(["about", "part_of"]);

/** 投稿を紐付けた出来事（告知・記録と本体）。外したものは含めない */
export function eventsOf(draft: DraftInput): string[] {
  return [
    ...new Set(
      (draft.links ?? [])
        .filter(
          (l) =>
            isPostLink(l) &&
            l.to_type === "event" &&
            EVENT_ROLES.has(l.role) &&
            l.accepted !== false,
        )
        .map((l) => l.to_id),
    ),
  ];
}

/** その出来事への紐付けが本体（part_of）か（決定記録 0083） */
export function isEventContent(draft: DraftInput, eventId: string): boolean {
  return (draft.links ?? []).some(
    (l) =>
      isPostLink(l) &&
      l.to_type === "event" &&
      l.to_id === eventId &&
      l.role === "part_of" &&
      l.accepted !== false,
  );
}

/**
 * 投稿を出来事に紐付ける・外す。content が true なら本体（part_of）、false なら告知・記録（about）として
 * 紐付ける（決定記録 0083）。人が足したものを外すときは取り除き、規則の候補は外したと記録する
 */
export function setEventLink(
  draft: DraftInput,
  eventId: string,
  on: boolean,
  content = false,
): DraftInput {
  const role = content ? "part_of" : "about";
  let links = [...(draft.links ?? [])];
  const isTo = (l: (typeof links)[number], r: string) =>
    isPostLink(l) && l.to_type === "event" && l.to_id === eventId && l.role === r;
  // 外すとき・役割を変えるときは、もう一方の役割の紐付けを外す
  const decline = (r: string) => {
    links = links.flatMap((l) =>
      !isTo(l, r)
        ? [l]
        : l.origin === "human"
          ? []
          : [{ ...l, accepted: false, evidence: { ...l.evidence, reviewed: true } }],
    );
  };
  if (!on) {
    decline("about");
    decline("part_of");
    return { ...draft, links };
  }
  decline(content ? "about" : "part_of");
  const index = links.findIndex((l) => isTo(l, role));
  const existing = index >= 0 ? links[index] : undefined;
  if (!existing) {
    links.push({
      from: "post",
      to_type: "event",
      to_id: eventId,
      role,
      origin: "human",
      confidence: 1,
    });
  } else {
    links[index] = {
      ...existing,
      accepted: true,
      origin: "human" as const,
      confidence: 1,
      evidence: { ...existing.evidence, reviewed: true },
    };
  }
  return { ...draft, links };
}
