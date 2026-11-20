/**
 * outcome.ts 单测（T-O1/T-O2）：四分支穷尽分发 / 组合子只在 completed 继续 /
 * interruptOf 提取中断。
 *
 * 牙齿说明：
 * - 「其余分支原样透传」用引用相等断言（assert.equal）——组合子一旦复制/换壳，
 *   中断原因与 AppError 本体（code/cause 都挂在原对象上）就会丢。
 * - matchOutcome 数回调次数：跑错分支、两个回调都跑、漏跑，当场红。
 * - 组合子的 fn 侧用计数器断言「非 completed 分支不得执行」，短路是契约不是实现细节。
 */
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  AppError  } from "../../src/errors/app-error.js";
import {  Outcome, type AbortReason  } from "../../src/errors/outcome.js";

describe("Outcome 四分支穷尽 + matchOutcome（T-O1）", () => {
  it("四个分支都能构造，matchOutcome 按 kind 分发并携带分支载荷", () => {
    const reason: AbortReason = "user-stop";
    const error = new AppError("AGENT_DOOM_LOOP");
    const outcomes: Outcome<number>[] = [
      { kind: "completed", value: 1 },
      { kind: "cancelled", reason },
      { kind: "replaced" },
      { kind: "failed", error },
    ];
    const labels = outcomes.map((o) => Outcome.match(o, { completed: (v) => `completed:${v}`, cancelled: (r) => `cancelled:${r}`, replaced: () => "replaced", failed: (e) => `failed:${e.key}` }));
    assert.deepEqual(labels, ["completed:1", "cancelled:user-stop", "replaced", "failed:AGENT_DOOM_LOOP"]);
  });

  it("matchOutcome 四回调各调用一次，不串分支", () => {
    let completedCalls = 0, cancelledCalls = 0, replacedCalls = 0, failedCalls = 0;
    const handlers = {
      completed: (v: number) => { completedCalls += 1; return `v${v}`; },
      cancelled: (r: AbortReason) => { cancelledCalls += 1; return `r:${r}`; },
      replaced: () => { replacedCalls += 1; return "replaced"; },
      failed: (e: AppError) => { failedCalls += 1; return `e:${e.key}`; },
    };
    assert.equal(Outcome.match({ kind: "completed", value: 7 }, handlers), "v7");
    assert.equal(Outcome.match({ kind: "cancelled", reason: "timeout" }, handlers), "r:timeout");
    assert.equal(Outcome.match({ kind: "replaced" }, handlers), "replaced");
    assert.equal(Outcome.match({ kind: "failed", error: new AppError("AGENT_DOOM_LOOP") }, handlers), "e:AGENT_DOOM_LOOP");
    assert.deepEqual({ completedCalls, cancelledCalls, replacedCalls, failedCalls }, { completedCalls: 1, cancelledCalls: 1, replacedCalls: 1, failedCalls: 1 });
  });
});

describe("组合子只在 completed 继续", () => {
  it("mapOutcome 变换 completed 的 value，其余分支同一对象透传且 fn 不被调用", () => {
    assert.deepEqual(Outcome.map({ kind: "completed", value: 2 }, (n) => n * 10), { kind: "completed", value: 20 });

    const cancelled: Outcome<number> = { kind: "cancelled", reason: "timeout" };
    const replaced: Outcome<number> = { kind: "replaced" };
    const failed: Outcome<number> = { kind: "failed", error: new AppError("AGENT_DOOM_LOOP") };
    let called = false;
    const touch = (): number => { called = true; return 0; };
    assert.equal(Outcome.map(cancelled, touch), cancelled, "cancelled 必须同一对象透传");
    assert.equal(Outcome.map(replaced, touch), replaced, "replaced 必须同一对象透传");
    assert.equal(Outcome.map(failed, touch), failed, "failed 必须同一对象透传");
    assert.equal(called, false, "非 completed 分支不得执行 fn");
  });

  it("andThenOutcome 在 completed 接续（可链到 failed），其余分支短路", () => {
    assert.deepEqual(Outcome.andThen({ kind: "completed", value: 3 }, (n) => ({ kind: "completed", value: n + 1 })), { kind: "completed", value: 4 });

    const error = new AppError("AGENT_DOOM_LOOP");
    const chained = Outcome.andThen({ kind: "completed", value: 3 }, (): Outcome<number> => ({ kind: "failed", error }));
    assert.deepEqual(chained, { kind: "failed", error }, "fn 返回 failed 时必须原样接续");

    const cancelled: Outcome<number> = { kind: "cancelled", reason: "shutdown" };
    const replaced: Outcome<number> = { kind: "replaced" };
    const failed: Outcome<number> = { kind: "failed", error };
    let called = false;
    const next = (n: number): Outcome<number> => { called = true; return { kind: "completed", value: n }; };
    assert.equal(Outcome.andThen(cancelled, next), cancelled, "cancelled 必须同一对象短路");
    assert.equal(Outcome.andThen(replaced, next), replaced, "replaced 必须同一对象短路");
    assert.equal(Outcome.andThen(failed, next), failed, "failed 必须同一对象短路");
    assert.equal(called, false, "非 completed 分支不得执行 fn");
  });
});

describe("interruptOf 提取中断（T-O2）", () => {
  it("cancelled / replaced 提取出对应 Interrupt，completed / failed 返回 null", () => {
    const reason: AbortReason = "parent";
    const cancelled = Outcome.interruptOf({ kind: "cancelled", reason });
    assert.deepEqual(cancelled, { kind: "cancelled", reason: "parent" });
    assert.equal(cancelled?.reason, reason, "中断原因必须原值携带");
    assert.deepEqual(Outcome.interruptOf({ kind: "replaced" }), { kind: "replaced" });
    assert.equal(Outcome.interruptOf({ kind: "completed", value: 1 }), null, "completed 不是中断");
    assert.equal(Outcome.interruptOf({ kind: "failed", error: new AppError("AGENT_DOOM_LOOP") }), null, "failed 不是中断");
  });

  it("提取产物按 Interrupt 两分支收窄可用", () => {
    const signal = Outcome.interruptOf({ kind: "cancelled", reason: "user-stop" });
    assert.ok(signal != null, "cancelled 必须提取出 Interrupt");
    if (signal?.kind === "cancelled") {
      assert.equal(signal.reason, "user-stop");
    } else {
      assert.fail("cancelled 必须落在 cancelled 分支");
    }
    const replaced = Outcome.interruptOf({ kind: "replaced" });
    assert.ok(replaced != null && replaced.kind === "replaced", "replaced 必须提取出 replaced 分支");
  });
});
