/**
 * ToolRunner 取消竞速（通用兜底）：回合 signal abort 时 call 立即 reject，
 * 不依赖工具自身监听 signal——否则 waiting 中的回合会被慢工具（curl / search
 * 等长请求）占住线程、停止按钮点不动。
 */
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { describe, it } from "node:test";
import { z } from "zod";

import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolError } from "../../src/errors/tool-errors.js";

describe("ToolRunner：回合取消竞速（A-24）", () => {
  it("工具永不返回时，abort 让 call 立即 reject（不等工具）", async () => {
    const registry = new ToolRegistry<{ readonly signal?: AbortSignal }>();
    registry.register({
      name: "hang",
      description: () => "hang",
      inputSchema: z.object({}),
      run: async () => {
        await new Promise<void>(() => undefined); // 永不 resolve
        return "unreachable";
      },
    });
    const runner = new ToolRunner(registry);
    const controller = new AbortController();
    const pending = runner.call("hang", {}, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (err: unknown) => {
      assert.ok(err instanceof ToolError);
      assert.match(String((err as { cause?: unknown }).cause), /工具调用已取消/);
      return true;
    });
  });

  it("signal 缺省时行为不变（旧装配点 / 测试 mock 兼容）", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "echo",
      description: () => "echo",
      inputSchema: z.object({ text: z.string() }),
      run: async (input: { text: string }) => input.text,
    });
    const runner = new ToolRunner(registry);
    assert.equal(await runner.call("echo", { text: "ok" }, {}), "ok");
  });

  it("进入时 signal 已 abort：run 零启动，call 直接拒绝（B-1 / G-1①：副作用前早退）", async () => {
    let runCount = 0;
    const registry = new ToolRegistry<{ readonly signal?: AbortSignal }>();
    registry.register({
      name: "side-effect",
      description: () => "side-effect",
      inputSchema: z.object({}),
      run: async () => {
        runCount += 1;
        return "done";
      },
    });
    const runner = new ToolRunner(registry);
    const controller = new AbortController();
    controller.abort(); // 先 abort 再 call：工具副作用必须还没启动就被拒
    await assert.rejects(runner.call("side-effect", {}, { signal: controller.signal }), (err: unknown) => {
      assert.ok(err instanceof ToolError);
      assert.match(String((err as { cause?: unknown }).cause), /工具调用已取消/);
      return true;
    });
    assert.equal(runCount, 0);
  });

  it("同一 controller 连续多次 call：正常完成后 abort listener 清零不积压（G-1②）", async () => {
    const registry = new ToolRegistry<{ readonly signal?: AbortSignal }>();
    registry.register({
      name: "echo",
      description: () => "echo",
      inputSchema: z.object({ text: z.string() }),
      run: async (input: { text: string }) => input.text,
    });
    const runner = new ToolRunner(registry);
    const controller = new AbortController();
    for (let i = 0; i < 3; i += 1) {
      assert.equal(await runner.call("echo", { text: `ok-${i}` }, { signal: controller.signal }), `ok-${i}`);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0, `第 ${i + 1} 次 call 结束后 abort listener 应已移除`);
    }
    // 清理成立 ⇒ 后续 call 照常工作（不被残留 listener 影响）。
    assert.equal(await runner.call("echo", { text: "after" }, { signal: controller.signal }), "after");
  });

  it("runParallel 中途 abort：逐 outcome 记失败且顺序对齐 calls，abort 后不再发起新 run（B-1② / G-1③）", async () => {
    const started: number[] = [];
    // 每个 run 挂起直到测试放行；released 索引单独放行以锁定 outcome 落位。
    const pending: Array<() => void> = [];
    let released = -1;
    const registry = new ToolRegistry<{ readonly signal?: AbortSignal }>();
    registry.register({
      name: "probe",
      description: () => "probe",
      inputSchema: z.object({ i: z.number() }),
      run: async (input: { i: number }) => {
        started.push(input.i);
        await new Promise<void>((resolve) => pending.push(resolve));
        return input.i;
      },
    });
    const runner = new ToolRunner(registry);
    const controller = new AbortController();
    const calls = Array.from({ length: 20 }, (_, i) => ({ name: "probe", input: { i } }));
    const runAll = runner.runParallel(calls, { signal: controller.signal }, { concurrency: 8 });
    const until = async (ok: () => boolean) => {
      while (!ok()) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    };
    // 首个 wave：8 个 worker 按队列序启动 0..7（每个 run 都挂起，无人释放）。
    await until(() => started.length >= 8);
    assert.deepEqual([...started], [0, 1, 2, 3, 4, 5, 6, 7]);
    // 只放行 index 3：其 outcome 落 {ok:true, output:3}，腾出的 worker 按序取 index 8。
    released = 3;
    pending[3]!();
    await until(() => started.length >= 9);
    controller.abort();
    const outcomes = await runAll;
    assert.equal(outcomes.length, 20);
    assert.deepEqual([...started], [0, 1, 2, 3, 4, 5, 6, 7, 8], "abort 后不得再发起新 run（worker 取队列仍按序）");
    for (let i = 0; i < 20; i += 1) {
      const outcome = outcomes[i]!;
      if (i === released) {
        assert.deepEqual(outcome, { ok: true, output: released }, `outcomes[${i}] 应为已放行的成功结果`);
      } else {
        assert.equal(outcome.ok, false, `outcomes[${i}] 应记失败`);
        if (!outcome.ok) assert.match(String((outcome.error as { cause?: unknown }).cause), /工具调用已取消/);
      }
    }
  });

  it("abort 竞速胜出后 work 才 reject：无 unhandled rejection（G-1④）", async () => {
    let rejectWork!: (reason?: unknown) => void;
    const registry = new ToolRegistry<{ readonly signal?: AbortSignal }>();
    registry.register({
      name: "late-reject",
      description: () => "late-reject",
      inputSchema: z.object({}),
      run: async () =>
        new Promise<string>((_, reject) => {
          rejectWork = reject;
        }),
    });
    const runner = new ToolRunner(registry);
    const controller = new AbortController();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const pending = runner.call("late-reject", {}, { signal: controller.signal });
      controller.abort();
      await assert.rejects(pending, (err: unknown) => {
        assert.ok(err instanceof ToolError);
        assert.match(String((err as { cause?: unknown }).cause), /工具调用已取消/);
        return true;
      });
      rejectWork(new Error("late failure")); // 竞速已结束才 reject：不得漏成 unhandled
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(unhandled, []);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
