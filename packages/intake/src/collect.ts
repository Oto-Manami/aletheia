// 全件を取り込む経路（振り分けを通る経路）の下書きに、規則で決まる紐付けを足す（設計書 決定記録 0021・0022）
//
// - 発信者: 情報源の持ち主（channels.owner_entity_id）を、投稿の発信者（author）として紐付ける
// - 言及: 蓄積対象（entities.attributes.archive_subject。人物と、その人の期）ごとに、別名の一致で
//   言及の候補を作る。期の「同期」のような呼び方は、書き手がその期に属するときだけ使う
// - 発信者が蓄積対象の人物なら、振り分けを通さず承認待ちから始める（本人のブログはすべて残す）
// - 登場するメンバー: タグ付けの候補（entities.attributes.tag_candidate）の名前が本文にあれば、言及の候補を
//   作る。承認のときに人が確かめる（確信度の低いものは「確認すること」に出る）
// どの人物・情報源かはデータから読み、コードには書かない。

import type { DraftInput } from "./draft.ts";
import { proposeSubjectLinks, type Subject } from "./mentions.ts";

export interface CollectionContext {
  /** 情報源の持ち主（発信者）の人物 ID。持ち主の無い情報源は null */
  ownerId: string | null;
  /** 蓄積対象（人物・グループ） */
  subjects: readonly Subject[];
  /** 発信者が属するグループ（member_of）の ID */
  ownerGroups?: readonly string[];
  /**
   * 登場するメンバーのタグ付けの候補（entities.attributes.tag_candidate）。本文に名前があれば、
   * 言及の候補を作る（振り分けの判断には使わない。承認のときに人が確かめる）
   */
  tagCandidates?: readonly Subject[];
}

export interface CollectionResult {
  draft: DraftInput;
  /** 振り分けを通すか（false なら承認待ちから始める） */
  triage: boolean;
}

export function applyCollectionRules(draft: DraftInput, ctx: CollectionContext): CollectionResult {
  let next: DraftInput = { ...draft, links: [...(draft.links ?? [])] };

  if (ctx.ownerId) {
    const ownerId = ctx.ownerId;
    const hasAuthor = (next.links ?? []).some(
      (l) => l.from === "post" && l.role === "author" && l.to_id === ownerId,
    );
    if (!hasAuthor) {
      next.links = [
        ...(next.links ?? []),
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
      ];
    }
  }

  const ownBlog = ctx.ownerId !== null && ctx.subjects.some((s) => s.id === ctx.ownerId);
  for (const subject of ctx.subjects) {
    // 本人が書いたものに、本人への言及・写っているかの候補は作らない
    if (subject.id === ctx.ownerId) continue;
    next = proposeSubjectLinks(next, subject, {
      peer: ctx.ownerGroups?.includes(subject.id) ?? false,
    });
  }
  const archiveIds = new Set(ctx.subjects.map((s) => s.id));
  for (const candidate of ctx.tagCandidates ?? []) {
    // 蓄積対象は上で扱った。書いた本人は自分の名前を書いても言及にしない
    if (archiveIds.has(candidate.id) || candidate.id === ctx.ownerId) continue;
    next = proposeSubjectLinks(next, { ...candidate, checkImages: false }, { purpose: "tag" });
  }
  return { draft: next, triage: !ownBlog };
}

/** 言及の検出の規則が付けた紐付け（付け直すときに外す）。人が選んだもの・発信者は残す */
export function withoutAliasMatches(draft: DraftInput): DraftInput {
  return {
    ...draft,
    links: (draft.links ?? []).filter(
      (l) => !(l.origin === "rule" && l.evidence?.["rule"] === "alias_match"),
    ),
  };
}
