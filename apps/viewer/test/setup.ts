// テストごとに、タブの中で覚えた画面のデータを捨てる（テストごとに架空のデータが違うため。決定記録 0062）
import { afterEach } from "vitest";
import { clearLoadCache } from "../src/load-cache.ts";

afterEach(() => {
  clearLoadCache();
});
