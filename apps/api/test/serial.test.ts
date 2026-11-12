// 承認を 1 件ずつ順に通す仕組み（データベースを使わない）

import { describe, expect, it } from "vitest";
import { serial } from "../src/serial.ts";

describe("serial", () => {
  it("呼ばれた順に 1 つずつ動かし、前が失敗しても次を動かす", async () => {
    const inOrder = serial();
    const log: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const task = (name: string, ms: number, fail = false) =>
      inOrder(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        log.push(`${name}:start`);
        await new Promise((r) => setTimeout(r, ms));
        log.push(`${name}:end`);
        running--;
        if (fail) throw new Error(name);
        return name;
      });

    const results = await Promise.allSettled([task("a", 20), task("b", 5, true), task("c", 1)]);

    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
    expect(maxRunning).toBe(1);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});
