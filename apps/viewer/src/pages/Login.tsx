import { useState } from "react";

export function Splash() {
  return (
    <div className="splash" role="status" aria-live="polite">
      <span className="wordmark">aletheia</span>
    </div>
  );
}

export function Login({ onSignIn, error }: { onSignIn: () => Promise<void>; error?: string }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <main className="gate">
      <h1 className="wordmark">aletheia</h1>
      <p className="gate-lead">招待された人だけが使えるアーカイブです。</p>
      <button
        type="button"
        className="button primary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailure(null);
          onSignIn().catch((e: unknown) => {
            setBusy(false);
            setFailure(e instanceof Error ? e.message : String(e));
          });
        }}
      >
        {busy ? "Discord に移動しています" : "Discord でログイン"}
      </button>
      {(failure ?? error) && (
        <p className="gate-error" role="alert">
          ログインできませんでした: {failure ?? error}
        </p>
      )}
    </main>
  );
}

export function NotRegistered({
  discordUserId,
  onSignOut,
}: {
  discordUserId: string | null;
  onSignOut: () => Promise<void>;
}) {
  return (
    <main className="gate">
      <h1 className="wordmark">aletheia</h1>
      <p className="gate-lead">
        ログインできましたが、まだ利用者として登録されていません。運営者に次の Discord のユーザー ID
        を伝えてください。
      </p>
      {discordUserId && <p className="gate-id">{discordUserId}</p>}
      <button type="button" className="button" onClick={() => void onSignOut()}>
        ログアウト
      </button>
    </main>
  );
}
