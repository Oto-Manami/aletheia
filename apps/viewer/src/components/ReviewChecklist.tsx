// 承認の前に確かめること（承認する人がやることを、上から順に並べる）
//
// 確かめ終わるまで承認できない。関係のない投稿・重複は却下、すぐに確かめられないことは保留にする。

import type { DraftInput } from "@aletheia/intake/draft";
import { Check, CircleAlert, X } from "lucide-react";
import { useId } from "react";
import { MEDIA_LABELS, pageLabel, ROLE_LABELS } from "../format.ts";
import { type ReviewItem, reviewItems } from "../source/summarize.ts";
import type { ArchiveSource, RefLabel } from "../source/types.ts";
import { AddLink } from "./DraftEditor.tsx";

type Draft = DraftInput;
type From = NonNullable<Draft["links"]>[number]["from"];

function edit(draft: Draft, fn: (d: Draft) => void): Draft {
  const next = structuredClone(draft);
  fn(next);
  return next;
}

/** 下書きの中の素材の呼び名（写真 2、p.12–13 など） */
export function assetLabel(draft: Draft, ref: string): string {
  const assets = draft.assets ?? [];
  const asset = assets.find((a) => a.ref === ref);
  if (!asset) return ref;
  const page = pageLabel(asset.attributes);
  if (page) return page;
  const sameType = assets.filter((a) => a.media_type === asset.media_type);
  const label = asset.media_type === "image" ? "写真" : (MEDIA_LABELS[asset.media_type] ?? "素材");
  return sameType.length > 1 ? `${label} ${sameType.indexOf(asset) + 1}` : label;
}

/** 言明の項目の呼び名。語彙はデータで持つため、ここに無いものはキーのまま出す */
const PROPERTY_LABELS: Record<string, string> = {
  started_activity: "始めたこと",
  favorite_food: "好きな食べ物",
};

/** 紐付けを、確かめやすい文にする（写真 2 に 〇〇 が写っている） */
function linkSentence(from: string, role: string, target: string): React.ReactNode {
  const f = <strong>{from}</strong>;
  const t = <strong>{target}</strong>;
  switch (role) {
    case "depicts":
      return (
        <>
          {f} に {t} が写っている
        </>
      );
    case "mentions":
      return (
        <>
          {f} で {t} に触れている
        </>
      );
    case "author":
      return (
        <>
          {f} を書いたのは {t}
        </>
      );
    case "speaks":
      return (
        <>
          {f} で {t} が話している
        </>
      );
    case "appears":
      return (
        <>
          {f} に {t} が出演している
        </>
      );
    case "covers":
      return (
        <>
          {f} は {t} を取り上げている
        </>
      );
    case "part_of":
      return (
        <>
          {f} は {t} に含まれる
        </>
      );
    default:
      return (
        <>
          {f} の「{ROLE_LABELS[role] ?? role}」は {t}
        </>
      );
  }
}

function fromLabel(draft: Draft, from: From): string {
  return from === "post" ? "投稿" : assetLabel(draft, from.asset);
}

/** 機械の提案を「合っている」「違う」にする */
function decideProposal(
  draft: Draft,
  item: Extract<ReviewItem, { kind: "low_link" | "low_statement" }>,
  answer: "confirm" | "decline" | "undo",
): Draft {
  return edit(draft, (d) => {
    const target = item.kind === "low_link" ? d.links?.[item.index] : d.statements?.[item.index];
    if (!target) return;
    const evidence = { ...target.evidence };
    delete evidence["reviewed"];
    if (answer === "confirm") evidence["reviewed"] = true;
    target.evidence = evidence;
    target.accepted = answer !== "decline";
  });
}

function StatusIcon({ item }: { item: ReviewItem }) {
  if (!item.resolved) {
    return (
      <span className="check-icon is-open" aria-label="まだ">
        <CircleAlert size={16} />
      </span>
    );
  }
  const declined = "declined" in item && item.declined;
  return (
    <span className={`check-icon ${declined ? "is-declined" : "is-done"}`} aria-label="済み">
      {declined ? <X size={14} /> : <Check size={14} />}
    </span>
  );
}

function ProposalItem({
  draft,
  item,
  labels,
  previews,
  readOnly,
  onChange,
}: {
  draft: Draft;
  item: Extract<ReviewItem, { kind: "low_link" | "low_statement" }>;
  labels: Map<string, string>;
  previews: Record<string, string>;
  readOnly: boolean;
  onChange: (d: Draft) => void;
}) {
  const label = (id: string) => labels.get(id) ?? "読み込んでいます";
  let question: React.ReactNode;
  let thumb: string | undefined;
  if (item.kind === "low_link") {
    const link = draft.links?.[item.index];
    if (!link) return null;
    if (link.from !== "post") thumb = previews[link.from.asset];
    question = linkSentence(fromLabel(draft, link.from), link.role, label(link.to_id));
  } else {
    const st = draft.statements?.[item.index];
    if (!st) return null;
    if (st.evidence_asset) thumb = previews[st.evidence_asset];
    question = (
      <>
        <strong>{label(st.subject_id)}</strong> の
        {PROPERTY_LABELS[st.property] ?? `「${st.property}」`}は{" "}
        <strong>
          {st.value_text ?? st.value_date ?? (st.value_entity_id ? label(st.value_entity_id) : "")}
        </strong>
      </>
    );
  }

  return (
    <>
      <p className="check-title">
        {item.kind === "low_link" ? "この紐付けは合っていますか" : "この言明は合っていますか"}
        <span className="origin">AI {Math.round(item.confidence * 100)}%</span>
      </p>
      <div className="check-proposal">
        {thumb && <img className="check-thumb" src={thumb} alt="" />}
        <p className="check-question">{question}</p>
      </div>
      {item.resolved ? (
        <p className="check-answer">
          {item.declined ? "違う（採用しない）" : "合っている"}
          {!readOnly && (
            <button
              type="button"
              className="link-button"
              onClick={() => onChange(decideProposal(draft, item, "undo"))}
            >
              やり直す
            </button>
          )}
        </p>
      ) : (
        <div className="check-buttons">
          <button
            type="button"
            className="button"
            disabled={readOnly}
            onClick={() => onChange(decideProposal(draft, item, "confirm"))}
          >
            <Check size={14} aria-hidden="true" />
            合っている
          </button>
          <button
            type="button"
            className="button"
            disabled={readOnly}
            onClick={() => onChange(decideProposal(draft, item, "decline"))}
          >
            <X size={14} aria-hidden="true" />
            違う
          </button>
        </div>
      )}
    </>
  );
}

function DateItem({
  draft,
  readOnly,
  onChange,
}: {
  draft: Draft;
  readOnly: boolean;
  onChange: (d: Draft) => void;
}) {
  const id = useId();
  return (
    <>
      <p className="check-title">日付を入れる</p>
      <p className="check-desc">
        日付がありません。元の投稿で、公開された日を確かめて入れてください。
      </p>
      <div className="check-inline">
        <label htmlFor={id} className="visually-hidden">
          日付
        </label>
        <input
          id={id}
          type="date"
          disabled={readOnly}
          value={draft.post.published_date ?? ""}
          onChange={(e) =>
            onChange(
              edit(draft, (d) => {
                if (e.target.value) {
                  d.post.published_date = e.target.value;
                  d.post.published_date_precision ??= "day";
                } else {
                  delete d.post.published_date;
                  delete d.post.published_date_precision;
                }
              }),
            )
          }
        />
      </div>
    </>
  );
}

function ThirdPartyItem({
  draft,
  item,
  readOnly,
  onChange,
}: {
  draft: Draft;
  item: ReviewItem;
  readOnly: boolean;
  onChange: (d: Draft) => void;
}) {
  const answer = (classification: "public" | "private") =>
    onChange(
      edit(draft, (d) => {
        d.post.classification = classification;
        d.context = { ...d.context, third_party_checked: true };
      }),
    );
  return (
    <>
      <p className="check-title">ファンなど第三者の投稿を、公開してよいか決める</p>
      <p className="check-desc">
        第三者の投稿は、既定で非公開にしています。写っている人や投稿した人のことを考えて、公開してよいかを決めてください。
      </p>
      {item.resolved ? (
        <p className="check-answer">
          {draft.post.classification === "public" ? "公開する" : "非公開のまま"}
          {!readOnly && (
            <button
              type="button"
              className="link-button"
              onClick={() =>
                onChange(
                  edit(draft, (d) => {
                    d.post.classification = "private";
                    d.context = { ...d.context, third_party_checked: false };
                  }),
                )
              }
            >
              やり直す
            </button>
          )}
        </p>
      ) : (
        <div className="check-buttons">
          <button
            type="button"
            className="button"
            disabled={readOnly}
            onClick={() => answer("private")}
          >
            非公開のまま
          </button>
          <button
            type="button"
            className="button"
            disabled={readOnly}
            onClick={() => answer("public")}
          >
            公開する
          </button>
        </div>
      )}
    </>
  );
}

export interface ReviewChecklistProps {
  draft: Draft;
  initial: Draft;
  onChange: (d: Draft) => void;
  labels: Map<string, string>;
  previews: Record<string, string>;
  source: ArchiveSource;
  readOnly: boolean;
  onLabel: (ref: RefLabel) => void;
}

export function ReviewChecklist(props: ReviewChecklistProps) {
  const { draft, initial, onChange, readOnly } = props;
  const items = reviewItems(draft, initial);
  const open = items.filter((i) => !i.resolved).length;

  return (
    <section className="panel checklist" aria-labelledby="checklist-title">
      <header className="checklist-head">
        <h3 id="checklist-title" className="checklist-title">
          確認すること
        </h3>
        {items.length > 0 && (
          <span className={`badge ${open === 0 ? "state-approved" : "state-on_hold"}`}>
            {open === 0 ? "すべて確認済み" : `残り ${open} 件`}
          </span>
        )}
      </header>

      {items.length === 0 ? (
        <p className="checklist-lead">
          機械が迷ったところはありません。元の投稿と下書きの内容が合っていれば、承認してください。
        </p>
      ) : (
        <ol className="checks">
          {items.map((item) => (
            <li key={item.key} className={`check ${item.resolved ? "is-resolved" : ""}`}>
              <StatusIcon item={item} />
              <div className="check-body">
                {item.kind === "missing_date" && (
                  <DateItem draft={draft} readOnly={readOnly} onChange={onChange} />
                )}
                {item.kind === "third_party" && (
                  <ThirdPartyItem
                    draft={draft}
                    item={item}
                    readOnly={readOnly}
                    onChange={onChange}
                  />
                )}
                {item.kind === "no_person" && (
                  <>
                    <p className="check-title">誰についての投稿かを選ぶ</p>
                    <p className="check-desc">
                      人物への紐付けがありません。登場する人・書いた人を名前で探して足してください。
                    </p>
                    {!item.resolved && !readOnly && (
                      <AddLink
                        source={props.source}
                        label="人物の名前"
                        onAdd={(ref, role) => {
                          props.onLabel(ref);
                          onChange(
                            edit(draft, (d) => {
                              d.links = [
                                ...(d.links ?? []),
                                {
                                  from: "post",
                                  to_type: ref.type,
                                  to_id: ref.id,
                                  role,
                                  origin: "human",
                                  confidence: 1,
                                },
                              ];
                            }),
                          );
                        }}
                      />
                    )}
                  </>
                )}
                {(item.kind === "low_link" || item.kind === "low_statement") && (
                  <ProposalItem
                    draft={draft}
                    item={item}
                    labels={props.labels}
                    previews={props.previews}
                    readOnly={readOnly}
                    onChange={onChange}
                  />
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="checklist-guide">
        関係のない投稿や重複は「却下」。すぐに確かめられないことがあるときは「保留」にして、理由をメモに残してください。
      </p>
    </section>
  );
}

/** 承認すると記録されるもの */
export function approvalSummary(draft: Draft): string {
  const links = draft.links ?? [];
  const statements = draft.statements ?? [];
  const declined =
    links.filter((l) => l.accepted === false).length +
    statements.filter((s) => s.accepted === false).length;
  const assets = draft.assets ?? [];
  const privateAssets = assets.filter(
    (a) => (a.classification ?? draft.post.classification) === "private",
  ).length;
  const parts = [
    `素材 ${assets.length} 件`,
    `紐付け ${links.filter((l) => l.accepted !== false).length} 件`,
  ];
  if (statements.length > 0) {
    parts.push(`言明 ${statements.filter((s) => s.accepted !== false).length} 件`);
  }
  const classification = draft.post.classification === "public" ? "公開" : "非公開";
  return (
    `${parts.join("、")}を記録します。投稿は${classification}` +
    (privateAssets > 0 ? `（非公開の素材 ${privateAssets} 件）` : "") +
    (declined > 0 ? `。採用しない提案 ${declined} 件も、却下した記録として残ります` : "") +
    "。"
  );
}
