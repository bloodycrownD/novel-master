/**
 * T-S2 / T-S3：fork 级联、deadline 取早、子 dispose 后从父摘除。
 *
 * 父 abort 时子 scope 的原因统一记为 `"parent"`（不复制父的 timeout/user-stop）；
 * deadline 取「自身 timeout」与「父 deadline」中较早者；子 dispose 后必须从父的
 * children 集合摘除，父之后再 abort 不得波及已经结束的子 scope。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAbortScope } from "@/domain/abort/logic/create-abort-scope.js";
import type { AbortSignalView } from "@/domain/abort/model/abort-scope.js";
import type { AbortReason } from "@/errors/outcome.js";

/** 等 onCancel 回调；1s 兜底避免实现回归时整条测试挂死。 */
function waitForCancel(view: Pick<AbortSignalView, "onCancel">): Promise<AbortReason | "__not_fired__"> {
  return Promise.race([
    new Promise<AbortReason>((resolve) => {
      view.onCancel(resolve);
    }),
    new Promise<"__not_fired__">((resolve) => setTimeout(() => resolve("__not_fired__"), 1_000)),
  ]);
}

describe("AbortScope.fork：级联与 deadline（T-S2）", () => {
  it("父 abort 级联子/孙，原因统一为 parent（不复制父原因）", () => {
    const parent = createAbortScope();
    const child = parent.fork();
    const grandchild = child.fork();
    parent.abort("timeout");
    assert.equal(parent.reason, "timeout");
    assert.equal(child.reason, "parent");
    assert.equal(grandchild.reason, "parent");
    assert.equal(child.signal.aborted, true);
    assert.equal(grandchild.signal.aborted, true);
    assert.deepEqual(child.checkpoint(), { kind: "cancelled", reason: "parent" });
    assert.deepEqual(grandchild.checkpoint(), { kind: "cancelled", reason: "parent" });
  });

  it("父已 abort 后再 fork：子立即以 parent 中断", () => {
    const parent = createAbortScope();
    parent.abort("shutdown");
    const lateChild = parent.fork();
    assert.equal(lateChild.reason, "parent");
    assert.equal(lateChild.signal.aborted, true);
    assert.deepEqual(lateChild.checkpoint(), { kind: "cancelled", reason: "parent" });
  });

  it("deadline 取早：子 timeout 更短用自己的，更长则精确等于父 deadline", () => {
    const parent = createAbortScope({ timeoutMs: 60_000 });
    const parentDeadline = parent.deadlineAt;
    assert.ok(parentDeadline != null);
    const shortChild = parent.fork({ timeoutMs: 5_000 });
    const longChild = parent.fork({ timeoutMs: 120_000 });
    const shortDeadline = shortChild.deadlineAt;
    assert.ok(shortDeadline != null);
    assert.ok(shortDeadline < parentDeadline, "子 timeout 更短时应取子的 deadline");
    assert.equal(longChild.deadlineAt, parentDeadline, "子 timeout 更长时应精确取父 deadline");
    shortChild.dispose();
    longChild.dispose();
    parent.dispose();
  });

  it("父无 deadline 时子的自身 timeout 就是唯一 deadline", () => {
    const parent = createAbortScope();
    const child = parent.fork({ timeoutMs: 5_000 });
    const deadline = child.deadlineAt;
    assert.ok(deadline != null);
    assert.ok(deadline > Date.now(), "deadline 应是未来时刻");
    child.dispose();
    parent.dispose();
  });

  it("父 deadline 更早：到点按 parent 中断子（子不另建定时器）", async () => {
    const parent = createAbortScope({ timeoutMs: 20 });
    const child = parent.fork({ timeoutMs: 60_000 });
    assert.equal(child.deadlineAt, parent.deadlineAt);
    assert.equal(await waitForCancel(child), "parent");
    assert.equal(child.reason, "parent");
    child.dispose();
    parent.dispose();
  });

  it("子自身 timeout 更早：子记 timeout，父不被反向取消", async () => {
    const parent = createAbortScope({ timeoutMs: 60_000 });
    const child = parent.fork({ timeoutMs: 20 });
    assert.equal(await waitForCancel(child), "timeout");
    assert.equal(child.reason, "timeout");
    assert.equal(parent.reason, null);
    assert.equal(parent.signal.aborted, false);
    child.dispose();
    parent.dispose();
  });
});

describe("AbortScope.fork：子 dispose 后从父摘除（T-S3）", () => {
  it("父 abort 时已 dispose 的子不被波及，存活兄弟仍收到 parent", () => {
    const parent = createAbortScope();
    const deadChild = parent.fork();
    const aliveChild = parent.fork();
    deadChild.dispose();
    parent.abort("shutdown");
    assert.equal(deadChild.reason, null, "已 dispose 的子保持未取消");
    assert.equal(deadChild.signal.aborted, false);
    assert.equal(deadChild.checkpoint(), null);
    assert.equal(aliveChild.reason, "parent");
    assert.equal(aliveChild.signal.aborted, true);
  });

  it("重复 dispose 子 scope 不报错，父仍可正常级联其余子 scope", () => {
    const parent = createAbortScope();
    const deadChild = parent.fork();
    deadChild.dispose();
    assert.doesNotThrow(() => deadChild.dispose());
    parent.abort("user-stop");
    assert.equal(deadChild.reason, null);
    assert.equal(parent.reason, "user-stop");
  });
});
