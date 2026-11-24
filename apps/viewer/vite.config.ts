/// <reference types="vitest/config" />
import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/** 本番のビルドの版の印（Vercel ではコミットの ID。無ければ手元のコミット、それも無ければ時刻） */
function buildVersion(): string {
  const fromVercel = process.env["VERCEL_GIT_COMMIT_SHA"];
  if (fromVercel) return fromVercel;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return new Date().toISOString();
  }
}

/** 版の印を version.json に書く（開いたままの画面が、新しい版に気づくため。src/version.ts） */
function versionFile(version: string): Plugin {
  return {
    name: "aletheia-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify({ version })}\n`,
      });
    },
  };
}

// mode = demo のときは、架空のデータで動くデモ版を 1 つの HTML にまとめて作る（画面の確認用）
export default defineConfig(({ command, mode }) => {
  // 版を見比べるのは本番のビルドだけ（手元の開発・デモ版・テストでは空にして見比べない）
  const version = command === "build" && mode !== "demo" ? buildVersion() : "";
  return {
    plugins: [
      react(),
      ...(mode === "demo" ? [viteSingleFile()] : []),
      ...(version ? [versionFile(version)] : []),
    ],
    define: { __APP_VERSION__: JSON.stringify(version) },
    build: { outDir: mode === "demo" ? "dist-demo" : "dist" },
    test: {
      environment: "jsdom",
      include: ["test/**/*.test.{ts,tsx}"],
      setupFiles: ["test/setup.ts"],
    },
  };
});
