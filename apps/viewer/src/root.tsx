// 起動: デモ版はそのまま、本番は Discord でのログインと利用者の登録を確かめてから画面を出す

import { createClient, type Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { createBrowserRouter, createHashRouter, RouterProvider } from "react-router";
import { Ctx } from "./context.tsx";
import { Login, NotRegistered, Splash } from "./pages/Login.tsx";
import { routes } from "./routes.tsx";
import { DemoSource } from "./source/demo.ts";
import { LiveSource } from "./source/live.ts";
import type { Viewer } from "./source/types.ts";
import { useLoad } from "./use-load.ts";

export function DemoRoot() {
  const source = useMemo(() => new DemoSource(), []);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  useEffect(() => {
    void source.viewer().then(setViewer);
  }, [source]);
  // デモ版は 1 つの HTML で動かすため、URL の # 以降で画面を切り替える
  const router = useMemo(() => createHashRouter(routes), []);
  if (!viewer) return <Splash />;
  return (
    <Ctx.Provider value={{ source, viewer }}>
      <RouterProvider router={router} />
    </Ctx.Provider>
  );
}

function env(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_PUBLISHABLE_KEY" | "VITE_API_URL"): string {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  if (!value) throw new Error(`${name} が設定されていません（apps/viewer/.env.example を参照）`);
  return value;
}

export function LiveRoot() {
  const supabase = useMemo(
    () => createClient(env("VITE_SUPABASE_URL"), env("VITE_SUPABASE_PUBLISHABLE_KEY")),
    [],
  );
  const source = useMemo(() => new LiveSource(supabase, env("VITE_API_URL")), [supabase]);
  const router = useMemo(() => createBrowserRouter(routes), []);
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const userId = session?.user.id;
  const [viewer] = useLoad(
    () => (userId ? source.viewer() : Promise.resolve(null)),
    [source, userId],
  );

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: window.location.href },
    });
  };
  const signOut = async () => {
    await supabase.auth.signOut();
  };

  if (session === undefined) return <Splash />;
  if (!session) return <Login onSignIn={signIn} />;
  if (viewer.status === "loading") return <Splash />;
  if (viewer.status === "error") {
    return <Login onSignIn={signIn} error={viewer.error.message} />;
  }
  if (!viewer.data) return <Splash />;
  if (!viewer.data.isMember) {
    return <NotRegistered discordUserId={viewer.data.discordUserId} onSignOut={signOut} />;
  }
  return (
    <Ctx.Provider value={{ source, viewer: viewer.data, signOut }}>
      <RouterProvider router={router} />
    </Ctx.Provider>
  );
}
