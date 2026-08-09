import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  SimpleEventBus,
} from "@novel-master/core/events";
import {
  decrementDesktopAgentActive,
  incrementDesktopAgentActive,
  isDesktopAgentActive,
} from "../src/main/runtime/agent-activity.js";
import {
  attachAgentRunLifecycleListeners,
  onCoreRunFinished,
  onCoreRunStarted,
} from "../src/main/ipc/handlers/agent.js";
import {
  attachEventBusForwarder,
  setEventBusForwardTarget,
} from "../src/main/ipc/forward-event-bus.js";
import { IPC_CHANNELS } from "../shared/ipc-types.js";

describe("agent run lifecycle", () => {
  afterEach(() => {
    while (isDesktopAgentActive()) {
      decrementDesktopAgentActive();
    }
  });

  it("RUN_FINISHED 递减后再次 decrement 幂等（不双减）", () => {
    incrementDesktopAgentActive();
    onCoreRunStarted({
      sessionId: "s-finish",
      projectId: "p1",
      runId: "run-1",
    });
    onCoreRunFinished({
      sessionId: "s-finish",
      projectId: "p1",
      runId: "run-1",
      stopReason: "end_turn",
    });
    assert.equal(isDesktopAgentActive(), false);
    decrementDesktopAgentActive();
    assert.equal(isDesktopAgentActive(), false);
  });

  it("T14: abort 不碰 refcount，保持 busy 直至 RUN_FINISHED", () => {
    // Phase 3 Step 24：abortAgentRun 改调 rt.abortRegistry.abort(sessionId)，
    // 不再依赖 activeRuns / 不再 decrement。refcount 单一归属 finishTrackedRun。
    // 这里不直接调 abortAgentRun（需 runtime 单例），而是验证契约本身：
    // 在收到 RUN_FINISHED 之前，refcount 恒为 true。
    incrementDesktopAgentActive();
    onCoreRunStarted({
      sessionId: "s-abort",
      projectId: "p1",
      runId: "run-abort",
    });
    // 此处模拟 abort 后的中间态——abort 既不 increment 也不 decrement，
    // 所以 refcount 维持 RUN_STARTED 后的状态。
    assert.equal(isDesktopAgentActive(), true);
    onCoreRunFinished({
      sessionId: "s-abort",
      projectId: "p1",
      runId: "run-abort",
      stopReason: "cancelled",
    });
    assert.equal(isDesktopAgentActive(), false);
  });

  it("stale RUN_FINISHED 不匹配 runId 时不递减", () => {
    incrementDesktopAgentActive();
    onCoreRunStarted({
      sessionId: "s-stale",
      projectId: "p1",
      runId: "run-a",
    });

    onCoreRunFinished({
      sessionId: "s-stale",
      projectId: "p1",
      runId: "run-b",
      stopReason: "end_turn",
    });
    assert.equal(isDesktopAgentActive(), true);
  });

  it("eventBus RUN_STARTED/FINISHED 订阅触发登记与清理", () => {
    const bus = new SimpleEventBus();
    const forwarded: unknown[] = [];
    setEventBusForwardTarget(() => ({
      send(channel: string, payload: unknown) {
        assert.equal(channel, IPC_CHANNELS.AGENT_STREAM);
        forwarded.push(payload);
      },
    }));
    attachEventBusForwarder(bus);
    attachAgentRunLifecycleListeners(bus);

    incrementDesktopAgentActive();
    bus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: "s-bus",
      projectId: "p1",
      runId: "run-bus",
    });

    bus.publish(EVENT_AGENT_RUN_FINISHED, {
      sessionId: "s-bus",
      projectId: "p1",
      runId: "run-bus",
      stopReason: "end_turn",
    });

    assert.equal(isDesktopAgentActive(), false);
    assert.equal(forwarded.length, 2);
  });
});
