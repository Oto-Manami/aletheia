/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// mode = demo のときは、架空のデータで動くデモ版を 1 つの HTML にまとめて作る（画面の確認用）
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "demo" ? [viteSingleFile()] : [])],
  build: { outDir: mode === "demo" ? "dist-demo" : "dist" },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
  },
}));
