/**
 * T-S6：`race()` 的取消竞速。
 *
 * Promise 没有 Result 通道，取消只能 reject（平台协议例外）：默认载荷是
 * `createAbortError()`，`rejectWith` 存在时用自定义载荷。`work` 在竞速已 settle
 * 之后才 reject 不得漏成 unhandledRejection；settle 后监听器必须摘除——
 * `AbortScope` 的内部监听不可直接观测，用裸 signal 的 `signalView` 路径读取
 * EventTarget 上的真实 listener 数量。
 */
import assert from "node:assert/strict";
import {  getEventListeners  } from "node:events";
import {  describe, it  } from "node:test";

import {  AbortScopeFactory  } from "@/domain/abort/logic/create-abort-scope.js";

/** 收集一个窗口内到达的 unhandledRejection（窗口内必须为 0）。 */
async function collectUnhandled(ms: number, action: () => Promise<void>): Promise<unknown[]> {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    await action();
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  return unhandled;
}

describe("race：取消竞速（T-S6）", () => {
  it("abort 时默认以 AbortError reject（平台协议例外，保留 reject）", async () => {
    const scope = AbortScopeFactory.create();
    const pending = scope.race(new Promise<string>(() => undefined));
    scope.abort("user-stop");
    await assert.rejects(pending, (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error).name, "AbortError");
      return true;
    });
  });

  it("rejectWith 自定义载荷按引用原样 reject", async () => {
    const scope = AbortScopeFactory.create();
    const payload = { code: "CUSTOM_CANCELLED" };
    const pending = scope.race(new Promise<string>(() => undefined), () => payload);
    scope.abort("shutdown");
    await assert.rejects(pending, (error: unknown) => {
      assert.equal(error, payload);
      return true;
    });
  });

  it("rejectWith 自身抛错也落到 reject，且不打断取消流程", async () => {
    const scope = AbortScopeFactory.create();
    const thrown = new Error("payload boom");
    const pending = scope.race(new Promise<string>(() => undefined), () => {
      throw thrown;
    });
    assert.doesNotThrow(() => scope.abort("timeout"));
    await assert.rejects(pending, (error: unknown) => {
      assert.equal(error, thrown);
      return true;
    });
    assert.equal(scope.reason, "timeout");
  });

  it("abort 先 settle、work 之后才 reject：不产生 unhandledRejection", async () => {
    const scope = AbortScopeFactory.create();
    let rejectWork!: (reason?: unknown) => void;
    const work = new Promise<string>((_, reject) => {
      rejectWork = reject;
    });
    const unhandled = await collectUnhandled(20, async () => {
      const pending = scope.race(work);
      scope.abort("user-stop");
      await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === "AbortError");
      rejectWork(new Error("late failure"));
    });
    assert.deepEqual(unhandled, []);
  });

  it("已 abort 的 scope：race 立即 reject，work 迟到的 reject 同样不泄漏", async () => {
    const scope = AbortScopeFactory.create();
    scope.abort("shutdown");
    let rejectWork!: (reason?: unknown) => void;
    const work = new Promise<string>((_, reject) => {
      rejectWork = reject;
    });
    const unhandled = await collectUnhandled(20, async () => {
      const pending = scope.race(work);
      await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === "AbortError");
      rejectWork(new Error("late failure"));
    });
    assert.deepEqual(unhandled, []);
  });

  it("race 正常 settle 后不再响应取消：之后的 abort 不触发 rejectWith", async () => {
    const scope = AbortScopeFactory.create();
    let payloadCalls = 0;
    const value = await scope.race(Promise.resolve("done"), () => {
      payloadCalls += 1;
      return new Error("should not reject");
    });
    assert.equal(value, "done");
    scope.abort("user-stop");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(payloadCalls, 0);
  });

  it("signalView.race：settle 后底层 abort listener 清零（resolve 与 reject 两条路径）", async () => {
    const controller = new AbortController();
    const view = AbortScopeFactory.signalView(controller.signal);

    let resolveWork!: (value: string) => void;
    const resolvedWork = new Promise<string>((resolve) => {
      resolveWork = resolve;
    });
    const resolvedPending = view.race(resolvedWork);
    assert.equal(getEventListeners(controller.signal, "abort").length, 1, "竞速期间应挂 1 个 listener");
    resolveWork("ok");
    assert.equal(await resolvedPending, "ok");
    assert.equal(getEventListeners(controller.signal, "abort").length, 0, "resolve 后 listener 应清零");

    let rejectWork!: (reason?: unknown) => void;
    const rejectedWork = new Promise<string>((_, reject) => {
      rejectWork = reject;
    });
    const rejectedPending = view.race(rejectedWork);
    assert.equal(getEventListeners(controller.signal, "abort").length, 1, "竞速期间应重新挂 1 个 listener");
    rejectWork(new Error("work failed"));
    await assert.rejects(rejectedPending, /work failed/);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0, "reject 后 listener 也应清零");
  });

  it("signalView.race：signal 已中断时立即 reject，且不挂 listener", async () => {
    const controller = new AbortController();
    controller.abort("timeout");
    const view = AbortScopeFactory.signalView(controller.signal);
    const pending = view.race(new Promise<string>(() => undefined));
    await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === "AbortError");
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
});
