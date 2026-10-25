// 利用者と招待（管理者だけ。設計書 決定記録 0019）
//
// 招待リンクは 1 回だけ・7 日まで使え、付く役割は閲覧者だけ。リンクは作った直後にだけ表示する。

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useApp } from "../context.tsx";
import { formatInstant } from "../format.ts";
import { inviteUrl } from "../invite.ts";
import type { CreatedInvite, InviteState, InviteView, MemberView } from "../source/types.ts";
import { useLoad } from "../use-load.ts";

const STATE_LABELS: Record<InviteState, string> = {
  open: "未使用",
  used: "使用済み",
  revoked: "取り消し",
  expired: "期限切れ",
};

const ROLE_LABELS = { admin: "管理者", viewer: "閲覧者" } as const;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function CreatedLink({ invite, onClose }: { invite: CreatedInvite; onClose: () => void }) {
  const url = inviteUrl(window.location.origin, invite.token);
  const [copied, setCopied] = useState(false);
  return (
    <div className="invite-created" role="status">
      <p className="invite-created-title">招待リンクを作りました</p>
      <div className="invite-url">
        <input
          readOnly
          value={url}
          aria-label="招待リンク"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          className="button"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => setCopied(true));
          }}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? "コピーしました" : "コピー"}
        </button>
      </div>
      <p className="field-hint">
        {`このリンクはいまだけ表示されます。${formatInstant(invite.expiresAt)} まで、1 回だけ使えます。Discord の DM などで本人に直接渡してください。`}
      </p>
      <button type="button" className="link-button" onClick={onClose}>
        閉じる
      </button>
    </div>
  );
}

function InviteRow({ invite, onRevoke }: { invite: InviteView; onRevoke: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="member-row">
      <div className="member-main">
        <span className="member-name">{invite.note ?? "（メモなし）"}</span>
        <span className="member-sub">
          {formatInstant(invite.createdAt)} に作成
          {invite.state === "open" && <> ・ {formatInstant(invite.expiresAt)} まで</>}
          {invite.state === "used" && (
            <>
              {" "}
              ・ {invite.usedByName ?? invite.usedBy} が {formatInstant(invite.usedAt ?? "")} に登録
            </>
          )}
        </span>
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
      </div>
      <span className={`tag invite-${invite.state}`}>{STATE_LABELS[invite.state]}</span>
      {invite.state === "open" && (
        <button
          type="button"
          className="button danger small"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            onRevoke().catch((e: unknown) => {
              setBusy(false);
              setError(message(e));
            });
          }}
        >
          取り消す
        </button>
      )}
    </li>
  );
}

function MemberRow({
  member,
  isSelf,
  onRemove,
}: {
  member: MemberView;
  isSelf: boolean;
  onRemove: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removable = member.role === "viewer" && !isSelf;
  return (
    <li className="member-row">
      <div className="member-main">
        <span className="member-name">
          {member.displayName ?? "（名前なし）"}
          {isSelf && <span className="quiet">（あなた）</span>}
        </span>
        <span className="member-sub">
          Discord {member.discordUserId} ・ {formatInstant(member.createdAt)} に登録
        </span>
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
      </div>
      <span className={`tag ${member.role === "admin" ? "role-admin" : ""}`}>
        {ROLE_LABELS[member.role]}
      </span>
      {removable &&
        (confirming ? (
          <span className="member-confirm">
            <button
              type="button"
              className="button danger small"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                onRemove().catch((e: unknown) => {
                  setBusy(false);
                  setError(message(e));
                });
              }}
            >
              外す
            </button>
            <button type="button" className="button small" onClick={() => setConfirming(false)}>
              やめる
            </button>
          </span>
        ) : (
          <button type="button" className="button small" onClick={() => setConfirming(true)}>
            外す…
          </button>
        ))}
    </li>
  );
}

export function MembersPage() {
  const { source, viewer } = useApp();
  const [invites, reloadInvites] = useLoad(() => source.listInvites(), [source]);
  const [members, reloadMembers] = useLoad(() => source.listMembers(), [source]);
  const [note, setNote] = useState("");
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  if (!viewer.isAdmin) {
    return (
      <section className="page narrow">
        <h1 className="page-title">利用者</h1>
        <p>利用者の画面は管理者だけが使えます。</p>
      </section>
    );
  }

  const create = () => {
    setCreating(true);
    setCreateError(null);
    source
      .createInvite(note)
      .then((invite) => {
        setCreated(invite);
        setNote("");
        reloadInvites();
      })
      .catch((e: unknown) => setCreateError(message(e)))
      .finally(() => setCreating(false));
  };

  return (
    <section className="page narrow">
      <div className="page-head">
        <h1 className="page-title">利用者</h1>
        <p className="page-sub">閲覧サイトは招待制です。招待した人は非公開のデータも読めます。</p>
      </div>

      <div className="panel panel-pad member-section">
        <h2 className="column-title">招待リンクを作る</h2>
        <form
          className="invite-form"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <div className="field grow">
            <label htmlFor="invite-note">誰に渡すか（メモ・任意）</label>
            <input
              id="invite-note"
              value={note}
              maxLength={100}
              placeholder="例: 試験さん"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button type="submit" className="button primary" disabled={creating}>
            {creating ? "作っています" : "招待リンクを作る"}
          </button>
        </form>
        <p className="field-hint">
          {
            "1 回だけ・7 日まで使えるリンクです。開いて Discord でログインした人が閲覧者になります。管理者にするのは運営者が行います。"
          }
        </p>
        {createError && (
          <p className="error" role="alert">
            {createError}
          </p>
        )}
        {created && <CreatedLink invite={created} onClose={() => setCreated(null)} />}
      </div>

      <div className="panel panel-pad member-section">
        <h2 className="column-title">招待</h2>
        {invites.status === "loading" && <p className="quiet">読み込んでいます</p>}
        {invites.status === "error" && (
          <p className="error" role="alert">
            招待を読めませんでした: {invites.error.message}
          </p>
        )}
        {invites.status === "ready" &&
          (invites.data.length === 0 ? (
            <p className="quiet">まだ招待はありません。</p>
          ) : (
            <ul className="member-list" aria-label="招待の一覧">
              {invites.data.map((invite) => (
                <InviteRow
                  key={invite.id}
                  invite={invite}
                  onRevoke={() => source.revokeInvite(invite.id).then(reloadInvites)}
                />
              ))}
            </ul>
          ))}
      </div>

      <div className="panel panel-pad member-section">
        <h2 className="column-title">利用者</h2>
        {members.status === "loading" && <p className="quiet">読み込んでいます</p>}
        {members.status === "error" && (
          <p className="error" role="alert">
            利用者を読めませんでした: {members.error.message}
          </p>
        )}
        {members.status === "ready" && (
          <ul className="member-list" aria-label="利用者の一覧">
            {members.data.map((member) => (
              <MemberRow
                key={member.discordUserId}
                member={member}
                isSelf={member.discordUserId === viewer.discordUserId}
                onRemove={() => source.removeMember(member.discordUserId).then(reloadMembers)}
              />
            ))}
          </ul>
        )}
        <p className="field-hint">閲覧者は外せます。管理者を外すのは運営者が行います。</p>
      </div>
    </section>
  );
}
