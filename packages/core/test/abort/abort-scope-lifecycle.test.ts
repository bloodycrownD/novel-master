/**
 * T-S7：onCancel 与 dispose 的生命周期。
 *
 * - deadline 到点自动 `abort("timeout")`；
 * - onCancel 在 abort 前注册、abort 时同步执行一次，注销后不再触发；
 * - 已中断时 onCancel 立即同步执行（清理钩子不会丢）；
 * - dispose 幂等、清定时器、不触发自身 onCancel（正常完成不是取消）；
 * - dispose 会中止未结束的子 scope，且只级联一次。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AbortScopeFactory } from "@/domain/abort/logic/create-abort-scope.js";

describe("onCancel 与 dispose 生命周期（T-S7）", () => {
  it("deadline 到点自动 abort(\"timeout\") 并通知 onCancel", async () => {
    const scope = AbortScopeFactory.create({ timeoutMs: 20 });
    const reason = await Promise.race([
      new Promise<string>((resolve) => {
        scope.onCancel((r) => resolve(r));
      }),
      new Promise<string>((resolve) => setTimeout(() => resolve("__not_fired__"), 1_000)),
    ]);
    assert.equal(reason, "timeout");
    assert.equal(scope.reason, "timeout");
    assert.equal(scope.signal.aborted, true);
    assert.deepEqual(scope.checkpoint(), { kind: "cancelled", reason: "timeout" });
    scope.dispose();
  });

  it("onCancel：abort 前注册的只收到一次；注销后不再触发；abort 后注册立即执行", () => {
    const scope = AbortScopeFactory.create();
    const reasons: string[] = [];
    const offKept = scope.onCancel((reason) => reasons.push(reason));
    const offDropped = scope.onCancel(() => reasons.push("dropped"));
    offDropped();
    scope.abort("shutdown");
    assert.deepEqual(reasons, ["shutdown"]);
    offKept();
    scope.abort("timeout");
    assert.deepEqual(reasons, ["shutdown"], "首因锁定后不应再次回调");

    const immediate: string[] = [];
    scope.onCancel((reason) => immediate.push(reason));
    assert.deepEqual(immediate, ["shutdown"], "已中断时 onCancel 必须立即同步执行");
  });

  it("单个 onCancel 抛错不阻断其余回调，也不改变 reason", () => {
    const scope = AbortScopeFactory.create();
    const called: string[] = [];
    scope.onCancel(() => {
      throw new Error("cleanup boom");
    });
    scope.onCancel(() => called.push("second"));
    assert.doesNotThrow(() => scope.abort("user-stop"));
    assert.deepEqual(called, ["second"]);
    assert.equal(scope.reason, "user-stop");
  });

  it("dispose 幂等：清定时器、不触发自身 onCancel、不 abort 自身 signal", async () => {
    const scope = AbortScopeFactory.create({ timeoutMs: 20 });
    const reasons: string[] = [];
    scope.onCancel((reason) => reasons.push(reason));
    scope.dispose();
    assert.doesNotThrow(() => scope.dispose());
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(reasons, [], "正常完成 dispose 不是取消，不得执行自身 onCancel");
    assert.equal(scope.reason, null, "定时器已被清掉，deadline 不得再触发 abort");
    assert.equal(scope.signal.aborted, false);
  });

  it("dispose 会中止未结束的子 scope，重复 dispose 只级联一次", () => {
    const parent = AbortScopeFactory.create();
    const child = parent.fork();
    const reasons: string[] = [];
    child.onCancel((reason) => reasons.push(reason));
    parent.dispose();
    parent.dispose();
    assert.deepEqual(reasons, ["parent"]);
    assert.equal(child.reason, "parent");
    assert.equal(child.signal.aborted, true);
  });
});
