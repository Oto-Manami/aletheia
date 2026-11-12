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
import { newsDates } from "../source/news-dates.ts";
import { draftWarnings, reviewItems } from "../source/summarize.ts";
import { appearsOf, authorsOf, confirmPeopleTags } from "../source/tags.ts";
import {
  type Decision,
  type IntakeDetail,
  type IntakeIssue,
  type RefLabel,
} from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { queueLabel, useIntakeOutlet } from "./IntakeList.tsx";
import { useQueued } from "./Layout.tsx";

const STATE_LABELS = {
  triage: "振り分け待ち",
  pending: "承認待ち",
  on_hold: "保留",
  approved: "承認済み",
  rejected: "却下",
} as const;

/** 判断を列に入れて次の下書きへ進んだときに、移った先で見せる言葉 */
const QUEUED_LABELS: Record<Decision, string> = {
  approve: "承認に回しました",
  reject: "却下に回しました",
  hold: "保留に回しました",
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
  // 開いている下書きは、ほかの判断が終わっても読み直さない（直している途中のものを消さない）
  const [detail, reload] = useLoad(() => source.getIntake(id), [source, id]);

  if (detail.status === "loading") return <p className="quiet">読み込んでいます</p>;
  if (detail.status === "error") {
    return (
      <p className="error" role="alert">
        下書きを読めませんでした: {detail.error.message}
      </p>
    );
  }
  // 下書きが変わったら、編集の状態を作り直す
  return (
    <IntakeEditor
      key={`${detail.data.id}:${detail.data.state}`}
      detail={detail.data}
      reload={reload}
    />
  );
}

function IntakeEditor({ detail, reload }: { detail: IntakeDetail; reload: () => void }) {
  const { source } = useApp();
  const layout = useIntakeOutlet();
  const { decisions } = layout;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // 判断の前に直していたものがあれば、そこから続ける（別の下書きを開いて戻ってきたとき）
  const [draft, setDraftState] = useState<DraftInput>(
    () =>
      (detail.state === "pending" || detail.state === "on_hold"
        ? decisions.editOf(detail.id)
        : undefined) ?? detail.draft,
  );
  const setDraft = (next: DraftInput) => {
    setDraftState(next);
    decisions.saveEdit(detail.id, next);
  };
  const queued = useQueued(decisions);
  const entry = queued.findLast((e) => e.id === detail.id);
  // 列で待っている・送っているもの・送り終えたものは、もう直せない
  const sent = entry !== undefined && entry.status !== "failed";
  // 取り込んだファイル（画像・保存した Web ページ）は、下書きとは別に読み、読めたものから出す
  const [loaded, setLoaded] = useState<{
    previews: Record<string, string>;
    pageHtml: Record<string, string>;
  }>({ previews: {}, pageHtml: {} });
  useEffect(
    () =>
      source.loadIntakeFiles?.(detail, (file) =>
        setLoaded((prev) => ({
          previews: file.previewUrl
            ? { ...prev.previews, [file.ref]: file.previewUrl }
            : prev.previews,
          pageHtml: file.html ? { ...prev.pageHtml, [file.ref]: file.html } : prev.pageHtml,
        })),
      ),
    [source, detail],
  );
  const previews = useMemo(
    () => ({ ...detail.previews, ...loaded.previews }),
    [detail.previews, loaded.previews],
  );
  const pageHtml = useMemo(
    () => ({ ...detail.pageHtml, ...loaded.pageHtml }),
    [detail.pageHtml, loaded.pageHtml],
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"reopen" | null>(null);
  const [reopenFailure, setReopenFailure] = useState<string | null>(null);
  // 送って失敗したときは、その理由を見せる（直したところは残っている）
  const failure: { message: string; issues: IntakeIssue[] } | null =
    entry?.status === "failed" ? (entry.failure ?? null) : null;
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
  const decidable = (detail.state === "pending" || detail.state === "on_hold") && !sent;
  const readOnly = !decidable || busy !== null;
  // 出来事をその場で作るときに、押せば入る日付の候補（題名・本文に出てくる日付。決定記録 0051）
  const eventDates = useMemo(() => {
    const at = detail.draft.post.published_at ? new Date(detail.draft.post.published_at) : null;
    return newsDates({
      title: detail.draft.post.title ?? "",
      body: (detail.draft.assets ?? [])
        .flatMap((a) => a.texts ?? [])
        .filter((t) => t.text_type === "body" || t.text_type === "caption")
        .map((t) => t.content)
        .join("\n"),
      publishedDate:
        at && !Number.isNaN(at.getTime())
          ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(at)
          : (detail.draft.post.published_date ?? null),
    });
  }, [detail.draft]);

  /** 却下を取り消し、承認待ちに戻す（却下した直近 10 件だけ。決定記録 0043） */
  const reopen = async () => {
    setBusy("reopen");
    setReopenFailure(null);
    try {
      await source.reopenIntake(detail.id);
      layout.changed();
      void navigate(
        { pathname: `/intake/${detail.id}`, search: params.toString() },
        { replace: true, state: { done: "承認待ちに戻しました" } },
      );
      reload();
    } catch (e) {
      setReopenFailure(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  /**
   * 判断を列に入れ、すぐ次の下書きへ進む。列は 1 件ずつ順に送り、送っている間もほかの下書きを直せる。
   * 結果は一覧の上の「判断の進み具合」に出る（失敗したものは、開き直すと理由と直したところが残っている）
   */
  const decide = (decision: Decision) => {
    const accepted = decisions.enqueue({
      id: detail.id,
      title: draft.post.title ?? detail.title,
      decision,
      // 画面で見せたタグ付け（写っている人・本文に出てくる人）は、人が確かめたものとして記録する
      ...(decision === "approve" ? { draft: confirmPeopleTags(draft) } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!accepted) return;
    // 承認待ちの一覧を見ているときは、まだ判断していない次の下書きへ進む
    const next = params.get("state") ? undefined : nextUndecided(layout.listIds, detail.id);
    if (!next) return;
    void navigate(
      { pathname: `/intake/${next}`, search: params.toString() },
      { replace: true, state: { done: QUEUED_LABELS[decision] } },
    );
  };

  /** 一覧で、この下書きの後ろ（無ければ前）にある、まだ列に入れていない下書き */
  function nextUndecided(ids: string[] | null, current: string): string | undefined {
    if (!ids) return undefined;
    const open = (id: string) =>
      id !== current && !queued.some((e) => e.id === id && e.status !== "failed");
    const at = ids.indexOf(current);
    return ids.slice(at + 1).find(open) ?? ids.slice(0, Math.max(at, 0)).find(open);
  }

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
          {detail.state === "pending" || detail.state === "on_hold" ? `前の下書きを${done}` : done}
        </p>
      )}
      {entry && entry.status !== "failed" && (
        <p className={`queue-notice queue-${entry.status}`} role="status">
          {queueLabel(entry)}
          {entry.status === "done" ? "。" : "。ほかの下書きを開いて、そのまま作業を続けられます。"}
        </p>
      )}
      {entry?.status === "done" && entry.outcome?.filesFailed && entry.outcome.postId ? (
        <p className="error" role="alert">
          ファイル {entry.outcome.filesFailed} 件を保存できませんでした（承認はできています）。
          <Link to={`/posts/${entry.outcome.postId}`}>投稿の画面</Link>
          の「ファイルの保存をやり直す」でやり直せます。
        </p>
      ) : null}

      {reviewItems(draft, detail.draft).length > 0 && (
        <ReviewChecklist
          draft={draft}
          initial={detail.draft}
          onChange={setDraft}
          labels={labels}
          previews={previews}
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
            previews={previews}
            readOnly={readOnly}
            chosenOnly={detail.chosenImagesOnly}
          />
          <MentionView draft={draft} ownPost={ownPost} />
          <details className="panel panel-pad more">
            <summary className="column-title">
              詳しく見る・直す
              <span className="dirty">元の投稿・保存の状況、日付・URL・公開区分など</span>
            </summary>
            <SourcePreview draft={draft} previews={previews} pageHtml={pageHtml} />
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
            dates={eventDates}
            // 承認の画面は作業者・運営者だけが使う
            allowCreate
          />
          {detail.state === "rejected" && (
            <div className="decision">
              <p className="decision-summary">
                却下したものは、直近 10
                件まで置いておきます。それより古いものは、下書きとファイルを削除します。
              </p>
              <button
                type="button"
                className="button block"
                disabled={busy !== null}
                onClick={() => void reopen()}
              >
                {busy === "reopen" ? "戻しています" : "承認待ちに戻す"}
              </button>
              {reopenFailure && (
                <p className="error" role="alert">
                  {reopenFailure}
                </p>
              )}
            </div>
          )}
          {decidable && (
            <div className="decision">
              <p className="decision-summary">{approvalSentence(draft, detail.chosenImagesOnly)}</p>
              <button
                type="button"
                className="button primary block"
                disabled={busy !== null || blocked !== null}
                onClick={() => decide("approve")}
              >
                {failure ? "もう一度承認する" : "承認する"}
              </button>
              {blocked && <p className="decision-blocked">{blocked}</p>}
              <div className="decision-secondary">
                <button
                  type="button"
                  className="button"
                  disabled={busy !== null || detail.state === "on_hold"}
                  onClick={() => decide("hold")}
                >
                  保留
                </button>
                <button
                  type="button"
                  className="button danger"
                  disabled={busy !== null}
                  onClick={() => decide("reject")}
                >
                  却下
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
                  <p>送れませんでした。直したところは残っています。</p>
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
