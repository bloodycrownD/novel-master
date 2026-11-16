/**
 * T-S8：`signalView(裸 signal)` 的只读适配。
 *
 * 裸 `AbortSignal` 没有可携带原因的位置：`reason` 恒为 `null`；一旦中断，
 * `checkpoint()` / `onCancel` 只能给最保守的 `"user-stop"`，且不得读取
 * `signal.reason`（RN/Hermes 上可能缺失）。
 */
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { describe, it } from "node:test";

import { signalView } from "@/domain/abort/logic/create-abort-scope.js";

describe("signalView：裸 AbortSignal 只读适配（T-S8）", () => {
  it("reason 恒为 null，即使 signal 已中断", () => {
    const controller = new AbortController();
    const view = signalView(controller.signal);
    assert.equal(view.reason, null);
    controller.abort("timeout");
    assert.equal(controller.signal.aborted, true);
    assert.equal(view.reason, null, "裸 signal 无从得知原因，reason 必须恒 null");
  });

  it("checkpoint：未中断 null；中断后给保守 user-stop，不读 signal.reason", () => {
    const controller = new AbortController();
    Object.defineProperty(controller.signal, "reason", {
      configurable: true,
      get() {
        throw new Error("实现不应读取 signal.reason");
      },
    });
    const view = signalView(controller.signal);
    assert.equal(view.checkpoint(), null);
    controller.abort("shutdown");
    const hit = view.checkpoint();
    assert.ok(hit != null);
    assert.equal(hit.kind, "cancelled");
    assert.equal(hit.reason, "user-stop");
    assert.equal(hit instanceof Error, false);
  });

  it("onCancel：提前注册在中断时收到保守原因；注销后不再触发", () => {
    const controller = new AbortController();
    const view = signalView(controller.signal);
    const reasons: string[] = [];
    const off = view.onCancel((reason) => reasons.push(reason));
    assert.equal(getEventListeners(controller.signal, "abort").length, 1);
    off();
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    controller.abort("timeout");
    assert.deepEqual(reasons, []);
  });

  it("onCancel：已中断后注册立即同步执行，并给保守 user-stop", () => {
    const controller = new AbortController();
    controller.abort("timeout");
    const view = signalView(controller.signal);
    const reasons: string[] = [];
    const off = view.onCancel((reason) => reasons.push(reason));
    assert.deepEqual(reasons, ["user-stop"]);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0, "立即执行路径不应再挂 listener");
    off();
  });
});
