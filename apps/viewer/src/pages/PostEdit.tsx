// 取り込んだ投稿・素材を後から直す（運営者だけ。設計書 決定記録 0076）
//
// 承認の画面と同じ欄で、投稿の今の中身を直す。保存すると違いだけを反映する（変更前の値は変更履歴に残る）。
// 素材の追加・削除・ファイルの差し替えはしない（要らない素材は投稿の画面の「素材を外す」で外す）
import type { DraftInput } from "@aletheia/intake/draft";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BackLink } from "../components/BackLink.tsx";
import { DraftEditor } from "../components/DraftEditor.tsx";
import { EventLinks } from "../components/EventLinks.tsx";
import { MentionView } from "../components/MentionView.tsx";
import { PhotoTags } from "../components/PhotoTags.tsx";
import { RecordPanel } from "../components/RecordPanel.tsx";
import { useApp } from "../context.tsx";
import { draftWarnings } from "../source/summarize.ts";
import { authorsOf } from "../source/tags.ts";
import type { PostEdit, PostView } from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { issuesOf, refsOf } from "./IntakeDetail.tsx";

export function PostEditPage() {
  const { id = "" } = useParams();
  const { source, viewer } = useApp();
  // 直すときは、覚えた古い中身を使わずに毎回読む（開いた時点の中身で保存を確かめるため）
  const [loaded] = useLoad(
    () => Promise.all([source.getPostEdit(id), source.getPost(id)]),
    [source, id],
  );

  if (!viewer.isAdmin) {
    return (
      <p className="page error" role="alert">
        取り込んだ投稿を直せるのは運営者だけです
      </p>
    );
  }
  if (loaded.status === "loading") return <p className="page quiet">読み込んでいます</p>;
  if (loaded.status === "error") {
    return (
      <p className="page error" role="alert">
        投稿を読めませんでした: {loaded.error.message}
      </p>
    );
  }
  const [edit, post] = loaded.data;
  return <PostEditor key={edit.basedOn} postId={id} edit={edit} post={post} />;
}

function PostEditor({ postId, edit, post }: { postId: string; edit: PostEdit; post: PostView }) {
  const { source } = useApp();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<DraftInput>(edit.draft);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [labels, setLabels] = useState(new Map<string, string>());
  const [candidates] = useLoad(() => source.listTagCandidates(), [source], [], "tag-candidates");
  const candidateList = candidates.status === "ready" ? candidates.data : [];
  const [subjects] = useLoad(() => source.listArchiveSubjects(), [source], [], "archive-subjects");
  const subjectList = subjects.status === "ready" ? subjects.data : [];
  const ownPost = authorsOf(draft).some((a) => subjectList.some((s) => s.id === a));
  const photoSubject =
    subjectList.find((s) => authorsOf(draft).includes(s.id)) ?? subjectList[0] ?? null;
  const name = (ref: string) =>
    labels.get(ref) ?? candidateList.find((c) => c.id === ref)?.label ?? "（読み込み中）";
  const onLabel = (ref: { id: string; label: string }) =>
    setLabels((prev) => new Map(prev).set(ref.id, ref.label));

  // 紐付けの行き先の名前を読む
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

  // 素材の画像（保存した原本の縮めた画像。読めなければ投稿の画面と同じ表示用の URL）
  const [previews, setPreviews] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      post.assets.filter((a) => a.previewUrl).map((a) => [a.id, a.previewUrl!] as const),
    ),
  );
  useEffect(() => {
    if (!source.assetThumbnail) return;
    const releases: (() => void)[] = [];
    let alive = true;
    for (const a of post.assets) {
      if (a.mediaType !== "image" && a.mediaType !== "video") continue;
      void source.assetThumbnail(a.id).then((t) => {
        if (!t) return;
        if (!alive) {
          t.release();
          return;
        }
        releases.push(t.release);
        setPreviews((prev) => ({ ...prev, [a.id]: t.url }));
      });
    }
    return () => {
      alive = false;
      for (const release of releases) release();
    };
  }, [source, post]);

  const issues = useMemo(() => issuesOf(draft), [draft]);
  const warnings = useMemo(() => draftWarnings(draft), [draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(edit.draft);

  const save = async () => {
    setSaving(true);
    setFailure(null);
    try {
      await source.savePostEdit(postId, draft, edit.basedOn);
      void navigate(`/posts/${postId}`, { state: { done: "投稿を直しました" } });
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <article className="page wide intake-detail post-edit">
      <header className="page-head">
        <BackLink to={`/posts/${postId}`}>投稿に戻る</BackLink>
        <h1 className="page-title">投稿を直す: {post.title ?? "（題名なし）"}</h1>
        <p className="page-sub">
          {edit.channelName}
          。保存すると、直したところだけを反映します（変更前の値は変更履歴に残ります）。素材の追加・削除はここではできません。
        </p>
      </header>

      <div className="approval-layout">
        <div className="approval-main">
          <PhotoTags
            draft={draft}
            onChange={setDraft}
            subject={photoSubject}
            candidates={candidateList}
            name={name}
            previews={previews}
            readOnly={saving}
            pickSeries
          />
          <MentionView draft={draft} ownPost={ownPost} onChange={setDraft} readOnly={saving} />
          <details className="panel panel-pad more" open>
            <summary className="column-title">
              詳しく直す
              <span className="dirty">本文・日付・URL・公開区分・紐付け・言明</span>
            </summary>
            <DraftEditor
              draft={draft}
              onChange={setDraft}
              labels={labels}
              issues={issues}
              warnings={warnings}
              source={source}
              readOnly={saving}
              onLabel={onLabel}
            />
          </details>
        </div>
        <aside className="approval-side panel panel-pad">
          <RecordPanel
            draft={draft}
            onChange={setDraft}
            candidates={candidateList}
            name={name}
            channelAvailability={edit.channelAvailability}
            {...(edit.channelKind === "message" ? { fixedAuthor: edit.channelOwnerId } : {})}
            readOnly={saving}
          />
          <EventLinks
            draft={draft}
            onChange={setDraft}
            name={name}
            onLabel={onLabel}
            readOnly={saving}
            allowCreate
          />
          <div className="decision">
            <button
              type="button"
              className="button primary block"
              disabled={saving || !dirty || issues.length > 0}
              onClick={() => void save()}
            >
              {saving ? "保存しています" : "直したところを保存する"}
            </button>
            {issues.length > 0 && (
              <p className="decision-blocked">直すところがあります（「詳しく直す」に出ています）</p>
            )}
            {failure && (
              <p className="error" role="alert">
                {failure}
              </p>
            )}
          </div>
        </aside>
      </div>
    </article>
  );
}
