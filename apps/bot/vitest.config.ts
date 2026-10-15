import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 同じデータベースを使うため、テストファイルを順番に実行する
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
