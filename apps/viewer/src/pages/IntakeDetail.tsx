import { type DraftInput, draftSchema } from "@aletheia/intake/draft";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { DraftEditor } from "../components/DraftEditor.tsx";
import { EventLinks } from "../components/EventLinks.tsx";
import { MentionView } from "../components/MentionView.tsx";
import { PhotoTags } from "../components/PhotoTags.tsx";
import { RecordPanel } from "../components/RecordPanel.tsx";
import { ReviewChecklist } from "../components/ReviewChecklist.tsx";
import { SourcePreview } from "../components/SourcePreview.tsx";
import { useApp } from "../context.tsx";
import { formatInstant } from "../format.ts";
import { draftWarnings, reviewItems } from "../source/summarize.ts";
import { appearsOf, authorsOf, confirmPeopleTags } from "../source/tags.ts";
import {
  type Decision,
  type IntakeDetail,
  type IntakeIssue,
  type RefLabel,
  SourceError,
} from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { useLayout } from "./Layout.tsx";

const STATE_LABELS = {
  triage: "振り分け待ち",
  pending: "承認待ち",
  on_hold: "保留",
  approved: "承認済み",
  rejected: "却下",
} as const;

const DONE_LABELS: Record<Decision, string> = {
  approve: "承認しました",
  reject: "却下しました",
  hold: "保留にしました",
};

function issuesOf(draft: DraftInput): IntakeIssue[] {
  const check = draftSchema.safeParse(draft);
  return check.success
    ? []
    : check.error.issues.map((i) => ({
        path: i.path.filter((p): p is string | number => typeof p !== "symbol"),
        message: i.message,
      }));
}

/** 承認すると何を保存するかを、ふだんの言葉で（紐付ける人は右側の一覧に出ている） */
/**
 * 承認すると保存するもの。chosenOnly（振り分けで残したもの・情報源の設定があるもの）は、写っている人を付けた画像だけを保存する
 * （設計書 決定記録 0037。承認の処理と同じ規則）
 */
function approvalSentence(draft: DraftInput, chosenOnly: boolean): string {
  const assets = draft.assets ?? [];
  const images = assets.filter((a) => a.media_type === "image");
  const photos = chosenOnly
    ? images.filter((a) => appearsOf(draft, a.ref).length > 0).length
    : images.length;
  const skipped = images.length - photos;
  const kept = [
    assets.some((a) => (a.texts ?? []).length > 0) ? "本文" : null,
    photos > 0 ? `写真 ${photos} 枚` : null,
    assets.some((a) => a.media_type === "webpage") ? "記事のページ" : null,
  ].filter(Boolean);
  const other = assets.filter(
    (a) => a.media_type !== "image" && a.media_type !== "webpage" && (a.texts ?? []).length === 0,
  ).length;
  if (other > 0) kept.push(`素材 ${other} 件`);
  const sentence = `承認すると、${kept.join("・") || "投稿"}を保存します。`;
  return skipped > 0
    ? `${sentence}写っている人を付けていない写真 ${skipped} 枚は保存しません。`
    : sentence;
}

function refsOf(draft: DraftInput): { id: string; type: RefLabel["type"] }[] {
  return [
    ...(draft.links ?? []).map((l) => ({ id: l.to_id, type: l.to_type })),
    ...(draft.statements ?? []).map((s) => ({ id: s.subject_id, type: "entity" as const })),
  ];
}

export function IntakeDetailPage() {
  const { id = "" } = useParams();
  const { source } = useApp();
  const layout = useLayout();
  const [detail] = useLoad(() => source.getIntake(id), [source, id, layout.version]);

  if (detail.status === "loading") return <p className="quiet">読み込んでいます</p>;
  if (detail.status === "error") {
    return (
      <p className="error" role="alert">
        下書きを読めませんでした: {detail.error.message}
      </p>
    );
  }
  // 下書きが変わったら、編集の状態を作り直す
  return <IntakeEditor key={`${detail.data.id}:${detail.data.state}`} detail={detail.data} />;
}

function IntakeEditor({ detail }: { detail: IntakeDetail }) {
  const { source } = useApp();
  const layout = useLayout();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [draft, setDraft] = useState<DraftInput>(detail.draft);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Decision | null>(null);
  const [failure, setFailure] = useState<{ message: string; issues: IntakeIssue[] } | null>(null);
  // 前の下書きを判断して、この下書きに進んできたときは、その結果を見せる
  const location = useLocation();
  const [done] = useState<string | null>(
    (location.state as { done?: string } | null)?.done ?? null,
  );
  const [labels, setLabels] = useState(new Map<string, string>());
  const [candidates] = useLoad(() => source.listTagCandidates(), [source]);
  const candidateList = candidates.status === "ready" ? candidates.data : [];
  // 写真を押して印を付ける人（蓄積対象の人物）
  const [subjects] = useLoad(() => source.listArchiveSubjects(), [source]);
  const subjectList = subjects.status === "ready" ? subjects.data : [];
  const ownPost = authorsOf(draft).some((a) => subjectList.some((s) => s.id === a));
  const photoSubject =
    subjectList.find((s) => authorsOf(draft).includes(s.id)) ?? subjectList[0] ?? null;
  const name = (id: string) =>
    labels.get(id) ?? candidateList.find((c) => c.id === id)?.label ?? "（読み込み中）";

  const refs = refsOf(draft);
  const refsKey = refs.map((r) => r.id).join(",");
  useEffect(() => {
    const missing = refs.filter((r) => !labels.has(r.id));
    if (missing.length === 0) return;
    void source
      .labels(missing)
      .then((found) =>
        setLabels((prev) => new Map([...prev, ...found.map((f) => [f.id, f.label] as const)])),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 参照先が増えたときだけ読む
  }, [source, refsKey]);

  const issues = useMemo(() => issuesOf(draft), [draft]);
  const warnings = useMemo(() => draftWarnings(draft), [draft]);
  const remaining = useMemo(
    () => reviewItems(draft, detail.draft).filter((i) => !i.resolved).length,
    [draft, detail.draft],
  );
  const decidable = detail.state === "pending" || detail.state === "on_hold";
  const readOnly = !decidable || busy !== null;

  const decide = async (decision: Decision) => {
    setBusy(decision);
    setFailure(null);
    try {
      // 次の承認待ちへ進むため、判断の前に一覧を読んでおく
      const pending = await source.listIntake("pending");
      await source.decide(detail.id, decision, {
        // 画面で見せたタグ付け（写っている人・本文に出てくる人）は、人が確かめたものとして記録する
        ...(decision === "approve" ? { draft: confirmPeopleTags(draft) } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      const label = DONE_LABELS[decision];
      layout.changed();
      // 承認待ちの一覧を見ているときは、次の下書きへ進む。結果は移った先で見せる
      const next = params.get("state") ? undefined : pending.find((p) => p.id !== detail.id);
      void navigate(
        { pathname: `/intake/${next?.id ?? detail.id}`, search: params.toString() },
        { replace: true, state: { done: label } },
      );
    } catch (e) {
      setFailure({
        message: e instanceof Error ? e.message : String(e),
        issues: e instanceof SourceError ? e.issues : [],
      });
    } finally {
      setBusy(null);
    }
  };

  const blocked =
    issues.length > 0
      ? "直すところがあるため承認できません（下の「詳しく見る・直す」）"
      : remaining > 0
        ? `上の「確認すること」があと ${remaining} 件あります`
        : null;
  const published = draft.post.published_at ?? draft.post.published_date ?? null;

  return (
    <article className="intake">
      <header className="intake-header">
        <Link className="back-link" to={{ pathname: "/intake", search: params.toString() }}>
          <ChevronLeft size={16} aria-hidden="true" />
          一覧に戻る
        </Link>
        {detail.state !== "pending" && (
          <p className="badges">
            <span className={`badge state-${detail.state}`}>{STATE_LABELS[detail.state]}</span>
          </p>
        )}
        <h2 className="intake-heading">{draft.post.title ?? detail.title ?? "（題名なし）"}</h2>
        <p className="intake-meta">
          {detail.channelName}
          {published && (
            <>
              <span className="sep" aria-hidden="true" />
              {published.length > 10 ? formatInstant(published) : published}
            </>
          )}
          {draft.post.url && (
            <>
              <span className="sep" aria-hidden="true" />
              <a
                href={draft.post.url}
                target="_blank"
                rel="noreferrer noopener"
                className="ext-link"
              >
                元の記事 <ExternalLink size={12} aria-hidden="true" />
              </a>
            </>
          )}
        </p>
        {typeof draft.context?.["memo"] === "string" && (
          <p className="memo">
            <span className="memo-label">投稿者のメモ</span>
            {draft.context["memo"]}
          </p>
        )}
        {detail.reviewedAt && detail.state !== "pending" && (
          <p className="intake-meta">
            {STATE_LABELS[detail.state]}：{formatInstant(detail.reviewedAt)}
            {detail.reviewedByName && <> ・ {detail.reviewedByName}</>}
          </p>
        )}
        {detail.reviewNote && (
          <p className="memo">
            <span className="memo-label">判断のメモ</span>
            {detail.reviewNote}
          </p>
        )}
      </header>

      {done && (
        <p className="done" role="status">
          {decidable ? `前の下書きを${done}` : done}
        </p>
      )}

      {reviewItems(draft, detail.draft).length > 0 && (
        <ReviewChecklist
          draft={draft}
          initial={detail.draft}
          onChange={setDraft}
          labels={labels}
          previews={detail.previews}
          source={source}
          readOnly={!decidable || busy !== null}
          onLabel={(ref) => setLabels((prev) => new Map(prev).set(ref.id, ref.label))}
        />
      )}

      <div className="approval-layout">
        <div className="approval-main">
          <PhotoTags
            draft={draft}
            onChange={setDraft}
            subject={photoSubject}
            candidates={candidateList}
            name={name}
            previews={detail.previews}
            readOnly={readOnly}
            chosenOnly={detail.chosenImagesOnly}
          />
          <MentionView draft={draft} ownPost={ownPost} />
          <details className="panel panel-pad more">
            <summary className="column-title">
              詳しく見る・直す
              <span className="dirty">元の投稿・保存の状況、日付・URL・公開区分など</span>
            </summary>
            <SourcePreview draft={draft} previews={detail.previews} pageHtml={detail.pageHtml} />
            <DraftEditor
              draft={draft}
              onChange={setDraft}
              labels={labels}
              issues={issues}
              warnings={warnings}
              source={source}
              readOnly={readOnly}
              onLabel={(ref) => setLabels((prev) => new Map(prev).set(ref.id, ref.label))}
            />
          </details>
        </div>
        <aside className="approval-side panel panel-pad">
          <RecordPanel
            draft={draft}
            onChange={setDraft}
            candidates={candidateList}
            name={name}
            channelAvailability={detail.channelAvailability}
            readOnly={readOnly}
          />
          <EventLinks
            draft={draft}
            onChange={setDraft}
            name={name}
            onLabel={(ref) => setLabels((prev) => new Map(prev).set(ref.id, ref.label))}
            readOnly={readOnly}
          />
          {decidable && (
            <div className="decision">
              <p className="decision-summary">{approvalSentence(draft, detail.chosenImagesOnly)}</p>
              <button
                type="button"
                className="button primary block"
                disabled={busy !== null || blocked !== null}
                onClick={() => void decide("approve")}
              >
                {busy === "approve" ? "承認しています" : "承認する"}
              </button>
              {blocked && <p className="decision-blocked">{blocked}</p>}
              <div className="decision-secondary">
                <button
                  type="button"
                  className="button"
                  disabled={busy !== null || detail.state === "on_hold"}
                  onClick={() => void decide("hold")}
                >
                  {busy === "hold" ? "保留にしています" : "保留"}
                </button>
                <button
                  type="button"
                  className="button danger"
                  disabled={busy !== null}
                  onClick={() => void decide("reject")}
                >
                  {busy === "reject" ? "却下しています" : "却下"}
                </button>
              </div>
              <details className="decision-note">
                <summary className="link-button">判断のメモを付ける</summary>
                <label htmlFor="decision-note" className="visually-hidden">
                  判断のメモ
                </label>
                <input
                  id="decision-note"
                  placeholder="判断のメモ（任意）"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </details>
              {failure && (
                <div className="error" role="alert">
                  <p>{failure.message}</p>
                  {failure.issues.length > 0 && (
                    <ul>
                      {failure.issues.map((i, n) => (
                        <li key={n}>
                          <code>{i.path.join(" › ")}</code> {i.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </article>
  );
}
