import { type DraftInput, draftSchema } from "@aletheia/intake/draft";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { DraftEditor } from "../components/DraftEditor.tsx";
import { SourcePreview } from "../components/SourcePreview.tsx";
import { Tags } from "../components/Tags.tsx";
import { useApp } from "../context.tsx";
import { formatInstant, routeLabel } from "../format.ts";
import { draftWarnings } from "../source/summarize.ts";
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
  const dirty = JSON.stringify(draft) !== JSON.stringify(detail.draft);
  const decidable = detail.state === "pending" || detail.state === "on_hold";

  const decide = async (decision: Decision) => {
    setBusy(decision);
    setFailure(null);
    try {
      // 次の承認待ちへ進むため、判断の前に一覧を読んでおく
      const pending = await source.listIntake("pending");
      await source.decide(detail.id, decision, {
        ...(decision === "approve" && dirty ? { draft } : {}),
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

  return (
    <article className="intake">
      <header className="intake-header">
        <p className="intake-state">
          {STATE_LABELS[detail.state]}
          <Tags classification={draft.post.classification} availability={draft.post.availability} />
        </p>
        <h2 className="intake-heading">{draft.post.title ?? detail.title ?? "（題名なし）"}</h2>
        <p className="intake-meta">
          {detail.channelName}
          <span className="sep" aria-hidden="true" />
          取り込み {formatInstant(detail.capturedAt)}
          <span className="sep" aria-hidden="true" />
          {routeLabel(detail.route)}
          <span className="sep" aria-hidden="true" />
          外部 ID {detail.externalId}
        </p>
        {typeof draft.context?.["memo"] === "string" && (
          <p className="memo">
            <span className="memo-label">投稿者のメモ</span>
            {draft.context["memo"]}
          </p>
        )}
        {detail.reviewNote && (
          <p className="memo">
            <span className="memo-label">判断のメモ</span>
            {detail.reviewNote}
          </p>
        )}
        <Link className="back-link" to={{ pathname: "/intake", search: params.toString() }}>
          一覧に戻る
        </Link>
      </header>

      <div className="intake-body">
        <section aria-label="元の投稿">
          <h3 className="column-title">元の投稿</h3>
          <SourcePreview draft={draft} previews={detail.previews} />
        </section>
        <section aria-label="下書き">
          <h3 className="column-title">
            下書き{dirty && <span className="dirty">直した内容は承認のときに送ります</span>}
          </h3>
          <DraftEditor
            draft={draft}
            onChange={setDraft}
            labels={labels}
            issues={issues}
            warnings={warnings}
            source={source}
            readOnly={!decidable || busy !== null}
            onLabel={(ref) => setLabels((prev) => new Map(prev).set(ref.id, ref.label))}
          />
        </section>
      </div>

      {decidable && (
        <footer className="actions">
          <div className="actions-note">
            <label htmlFor="decision-note" className="visually-hidden">
              判断のメモ
            </label>
            <input
              id="decision-note"
              placeholder="判断のメモ（任意）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="actions-buttons">
            <button
              type="button"
              className="button danger"
              disabled={busy !== null}
              onClick={() => void decide("reject")}
            >
              {busy === "reject" ? "却下しています" : "却下"}
            </button>
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
              className="button primary"
              disabled={busy !== null || issues.length > 0}
              title={issues.length > 0 ? "直すところがあるため承認できません" : undefined}
              onClick={() => void decide("approve")}
            >
              {busy === "approve" ? "承認しています" : dirty ? "直して承認" : "承認"}
            </button>
          </div>
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
        </footer>
      )}
      {done && (
        <p className="done" role="status">
          {decidable ? `前の下書きを${done}` : done}
        </p>
      )}
    </article>
  );
}
