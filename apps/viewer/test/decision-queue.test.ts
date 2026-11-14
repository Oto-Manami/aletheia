// 承認・保留・却下の順番待ちの列

import { describe, expect, it } from "vitest";
import { DecisionQueue } from "../src/decision-queue.ts";
import { type Decision, SourceError } from "../src/source/types.ts";

/** 送られた順と、同時に送っていた数を記録する窓口。resolve を呼ぶまで返さない */
function fakeSource() {
  const calls: { id: string; decision: Decision }[] = [];
  const waiting: { id: string; finish: (error?: Error) => void }[] = [];
  let running = 0;
  let maxRunning = 0;
  return {
    calls,
    get maxRunning() {
      return maxRunning;
    },
    /** いちばん古い送信を終わらせる */
    finishNext(error?: Error) {
      waiting.shift()?.finish(error);
    },
    pending: () => waiting.map((w) => w.id),
    decide(id: string, decision: Decision) {
      calls.push({ id, decision });
      running++;
      maxRunning = Math.max(maxRunning, running);
      return new Promise<object>((resolve, reject) => {
        waiting.push({
          id,
          finish: (error) => {
            running--;
            if (error) reject(error);
            else resolve({});
          },
        });
      });
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("判断の順番待ちの列", () => {
  it("入れた順に 1 件ずつ送り、前が終わってから次を送る", async () => {
    const source = fakeSource();
    let settled = 0;
    const queue = new DecisionQueue(source, () => settled++);
    queue.enqueue({ id: "a", title: "A", decision: "approve" });
    queue.enqueue({ id: "b", title: "B", decision: "reject" });
    queue.enqueue({ id: "c", title: "C", decision: "approve" });
    await tick();

    expect(source.pending()).toEqual(["a"]);
    expect(queue.snapshot().map((e) => e.status)).toEqual(["running", "waiting", "waiting"]);

    source.finishNext();
    await tick();
    expect(source.pending()).toEqual(["b"]);
    source.finishNext();
    await tick();
    source.finishNext();
    await queue.idle();

    expect(source.calls.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(source.maxRunning).toBe(1);
    expect(queue.snapshot().map((e) => e.status)).toEqual(["done", "done", "done"]);
    expect(settled).toBe(3);
    expect(queue.busy).toBe(false);
  });

  it("同じ下書きは、待っている間・送り終えた後に、二重に入れない", async () => {
    const source = fakeSource();
    const queue = new DecisionQueue(source);
    expect(queue.enqueue({ id: "a", title: "A", decision: "approve" })).toBe(true);
    expect(queue.enqueue({ id: "a", title: "A", decision: "approve" })).toBe(false);
    expect(queue.enqueue({ id: "a", title: "A", decision: "reject" })).toBe(false);
    await tick();
    source.finishNext();
    await queue.idle();
    expect(queue.enqueue({ id: "a", title: "A", decision: "approve" })).toBe(false);
    expect(source.calls).toHaveLength(1);
  });

  it("失敗しても次の判断は送り、失敗したものは理由を残してもう一度入れられる", async () => {
    const source = fakeSource();
    const queue = new DecisionQueue(source);
    queue.enqueue({ id: "a", title: "A", decision: "approve" });
    queue.enqueue({ id: "b", title: "B", decision: "approve" });
    await tick();
    source.finishNext(
      new SourceError("下書きに直すところがあります", 422, [{ path: ["post"], message: "x" }]),
    );
    await tick();
    expect(source.pending()).toEqual(["b"]);
    source.finishNext();
    await queue.idle();

    const failed = queue.entryOf("a")!;
    expect(failed.status).toBe("failed");
    expect(failed.failure).toEqual({
      message: "下書きに直すところがあります",
      issues: [{ path: ["post"], message: "x" }],
    });
    expect(queue.entryOf("b")?.status).toBe("done");

    expect(queue.enqueue({ id: "a", title: "A", decision: "approve" })).toBe(true);
    // 失敗した前の記録は、入れ直したものに置き換わる
    expect(queue.snapshot().filter((e) => e.id === "a")).toHaveLength(1);
    await tick();
    source.finishNext();
    await queue.idle();
    expect(queue.entryOf("a")?.status).toBe("done");
  });

  it("直している途中の下書きは、送り終えるまで残し、送り終えたら消す", async () => {
    const source = fakeSource();
    const queue = new DecisionQueue(source);
    const draft = { post: { title: "直した題名" } } as never;
    queue.saveEdit("a", "t1", draft);
    expect(queue.editOf("a", "t1")).toBe(draft);
    // 貼り直しで置き換わった下書き（取り込んだ日時が違う）には、前の直しを当てない
    expect(queue.editOf("a", "t2")).toBeUndefined();

    queue.enqueue({ id: "a", title: "A", decision: "approve", draft });
    await tick();
    source.finishNext(new Error("つながりません"));
    await queue.idle();
    expect(queue.editOf("a", "t1")).toBe(draft);

    queue.enqueue({ id: "a", title: "A", decision: "approve", draft });
    await tick();
    source.finishNext();
    await queue.idle();
    expect(queue.editOf("a", "t1")).toBeUndefined();
  });

  it("送っている途中のものは閉じられず、終わったものは閉じられる", async () => {
    const source = fakeSource();
    const queue = new DecisionQueue(source);
    queue.enqueue({ id: "a", title: "A", decision: "hold" });
    await tick();
    const seq = queue.entryOf("a")!.seq;
    queue.dismiss(seq);
    expect(queue.snapshot()).toHaveLength(1);
    source.finishNext();
    await queue.idle();
    queue.dismiss(seq);
    expect(queue.snapshot()).toHaveLength(0);
  });
});
