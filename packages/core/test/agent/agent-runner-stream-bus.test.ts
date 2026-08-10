import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
  type AgentStreamTextDeltaPayload,
  type AgentStreamThinkingDeltaPayload,
  type AgentStreamToolUsePayload,
} from "../../src/domain/events/model/event-types.js";
import { SimpleEventBus } from "../../src/infra/events/simple-event-bus.js";
import { wrapStreamForBus } from "../../src/service/agent/impl/agent-runner.js";

const RUN_ID = "run-test-uuid";

/**
 * 把当前 microtask 队列彻底抽干。`await Promise.resolve()` 只能 drain 一格，
 * 改造后的 wrapStreamForBus 用单条 queueMicrotask 合并刷新，跑一次就够；
 * 为了在多批次场景也稳妥，循环几次把链式调度的尾巴也吃掉。
 */
async function drainMicrotasks(depth = 4): Promise<void> {
  for (let i = 0; i < depth; i++) {
    await Promise.resolve();
  }
}

describe("agent-runner stream bus", () => {
  it("同批次 stream event 合并到单条 microtask 刷新，顺序确定", async () => {
    const bus = new SimpleEventBus();
    const sessionId = "sess-1";
    const published: string[] = [];
    let userCalled = false;

    bus.subscribe(EVENT_AGENT_STREAM_TEXT_DELTA, () => {
      published.push("text-delta");
    });
    bus.subscribe(EVENT_AGENT_STREAM_THINKING_DELTA, () => {
      published.push("thinking-delta");
    });
    bus.subscribe(EVENT_AGENT_STREAM_TOOL_USE, () => {
      published.push("tool-use");
    });

    const onStream = wrapStreamForBus(bus, sessionId, RUN_ID, {}, () => {
      userCalled = true;
      // userOnStream 在 publish 之前同步触发，所以这里 published 必须仍是空的——
      // bus.publish 永远被推迟到 microtask 里跑，避免订阅者重入 runner。
      assert.equal(
        published.length,
        0,
        "userOnStream 必须先于 bus.publish，publish 不能同步执行",
      );
    });
    assert.ok(onStream);

    onStream!({ type: "text-delta", text: "hi" });
    assert.equal(userCalled, true);
    // 同步阶段：publish 仍未发生（推迟到 microtask）。
    assert.equal(published.length, 0);

    onStream!({ type: "thinking-delta", text: "think" });
    onStream!({
      type: "tool-use",
      id: "t1",
      name: "read",
      input: { path: "a.txt" },
    });
    // 三条 event 都已入队，但还在同一同步批次内，bus.publish 仍未触发。
    assert.equal(published.length, 0);

    await drainMicrotasks();
    assert.deepEqual(published, [
      "text-delta",
      "thinking-delta",
      "tool-use",
    ]);
  });

  it("没有 userOnStream 时仍走合并 microtask 刷新", async () => {
    const bus = new SimpleEventBus();
    const published: string[] = [];

    bus.subscribe(EVENT_AGENT_STREAM_TEXT_DELTA, () => {
      published.push("text-delta");
    });

    const onStream = wrapStreamForBus(bus, "sess-2", RUN_ID);
    assert.ok(onStream);

    onStream!({ type: "text-delta", text: "x" });
    assert.equal(published.length, 0);

    await drainMicrotasks();
    assert.deepEqual(published, ["text-delta"]);
  });

  it("STREAM_* payload 携带 runId", async () => {
    const bus = new SimpleEventBus();
    const sessionId = "sess-run-id";
    const payloads: Array<
      | AgentStreamTextDeltaPayload
      | AgentStreamThinkingDeltaPayload
      | AgentStreamToolUsePayload
    > = [];

    bus.subscribe(EVENT_AGENT_STREAM_TEXT_DELTA, (p) => payloads.push(p));
    bus.subscribe(EVENT_AGENT_STREAM_THINKING_DELTA, (p) => payloads.push(p));
    bus.subscribe(EVENT_AGENT_STREAM_TOOL_USE, (p) => payloads.push(p));

    const onStream = wrapStreamForBus(bus, sessionId, RUN_ID);
    onStream!({ type: "text-delta", text: "a" });
    onStream!({ type: "thinking-delta", text: "b" });
    onStream!({
      type: "tool-use",
      id: "t1",
      name: "read",
      input: { path: "x" },
    });

    await drainMicrotasks();

    assert.equal(payloads.length, 3);
    for (const p of payloads) {
      assert.equal(p.sessionId, sessionId);
      assert.equal(p.runId, RUN_ID);
    }
  });

  // T-SC8：queueMicrotask 改造后多次运行事件顺序一致。
  // 旧实现给每条 event 各自 queueMicrotask，跨批次 / 跨订阅者的微任务交错可能打乱顺序；
  // 改成单条 microtask 合并刷新后，多轮独立调用都必须产出严格相同的 publish 序列。
  it("T-SC8: 多次独立运行的 publish 顺序严格一致", async () => {
    const expected: string[] = [];
    const eventSeq = [
      "text-delta",
      "text-delta",
      "thinking-delta",
      "text-delta",
      "tool-use",
      "thinking-delta",
    ] as const;

    const observedRuns: string[][] = [];

    for (let run = 0; run < 5; run++) {
      const bus = new SimpleEventBus();
      const published: string[] = [];
      bus.subscribe(EVENT_AGENT_STREAM_TEXT_DELTA, () =>
        published.push("text-delta"),
      );
      bus.subscribe(EVENT_AGENT_STREAM_THINKING_DELTA, () =>
        published.push("thinking-delta"),
      );
      bus.subscribe(EVENT_AGENT_STREAM_TOOL_USE, () =>
        published.push("tool-use"),
      );

      const onStream = wrapStreamForBus(bus, `sess-sc8-${run}`, RUN_ID);
      assert.ok(onStream);
      // 故意把 publish 交错穿插：连续同类型 + 中间穿插 microtask drain，
      // 验证同批次内与跨批次的相对顺序都被保留。
      for (let i = 0; i < eventSeq.length; i++) {
        const ev = eventSeq[i]!;
        if (ev === "tool-use") {
          onStream!({
            type: "tool-use",
            id: `t-${run}-${i}`,
            name: "read",
            input: { path: "x" },
          });
        } else {
          onStream!({ type: ev, text: `chunk-${run}-${i}` });
        }
        if (i === 2) {
          // 在序列中途 drain 一次，强制把前 3 条切到独立 microtask 批次。
          await drainMicrotasks();
        }
      }
      await drainMicrotasks();
      observedRuns.push(published);
    }

    if (expected.length === 0) {
      expected.push(...observedRuns[0]!);
    }
    for (const run of observedRuns) {
      assert.deepEqual(
        run,
        expected,
        "每次独立运行的 publish 序列必须完全一致",
      );
    }
    assert.deepEqual(expected, [...eventSeq]);
  });
});
