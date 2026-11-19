/**
 * T-S1：取消原因（reason）的来源与首因锁定。
 *
 * reason 只存在 scope 自己身上，**不从 `signal.reason` 读**——RN/Hermes 上
 * `abort-controller@3.0.0` 作传递依赖可能丢 reason；裸 controller 中断一律按
 * 最保守的 `"user-stop"` 记录。首个原因锁定后，后续 abort 不得覆盖。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AbortScopeFactory } from "@/domain/abort/logic/create-abort-scope.js";

describe("AbortScopeFactory.create：reason 来源与首因锁定（T-S1）", () => {
  it("初始状态：reason 为 null、signal 未中断、无 deadline", () => {
    const scope = AbortScopeFactory.create();
    assert.equal(scope.reason, null);
    assert.equal(scope.signal.aborted, false);
    assert.equal(scope.deadlineAt, null);
    const hit = scope.checkpoint();
    assert.equal(hit, null);
  });

  it("不读 signal.reason：getter 抛错也不影响显式 abort 记录的 reason", () => {
    const controller = new AbortController();
    // 任何对 signal.reason 的读取都会抛错——实现若依赖它就会当场炸。
    Object.defineProperty(controller.signal, "reason", {
      configurable: true,
      get() {
        throw new Error("实现不应读取 signal.reason");
      },
    });
    const scope = AbortScopeFactory.create({ controller });
    scope.abort("shutdown");
    assert.equal(scope.reason, "shutdown");
    assert.equal(scope.signal.aborted, true);
  });

  it("外部 controller abort 时忽略 signal.reason，按保守的 user-stop 记录", () => {
    const controller = new AbortController();
    const scope = AbortScopeFactory.create({ controller });
    // 伪造误导性的 reason：裸 controller 中断无从得知真实原因。
    Object.defineProperty(controller.signal, "reason", { configurable: true, get: () => "timeout" });
    controller.abort("timeout");
    assert.equal(scope.reason, "user-stop");
  });

  it("首因锁定：二次 abort 不覆盖首次原因，checkpoint 与 onCancel 只见首因", () => {
    const scope = AbortScopeFactory.create();
    const cancelled: string[] = [];
    scope.onCancel((reason) => cancelled.push(reason));
    scope.abort("user-stop");
    scope.abort("timeout");
    assert.equal(scope.reason, "user-stop");
    const hit = scope.checkpoint();
    assert.ok(hit != null);
    assert.equal(hit.kind, "cancelled");
    assert.equal(hit.reason, "user-stop");
    assert.deepEqual(cancelled, ["user-stop"], "onCancel 只应收到一次首因");
  });
});
