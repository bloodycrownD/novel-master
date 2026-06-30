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

  it("forward-event-bus RUN_STARTED/FINISHED 触发登记与清理", () => {
    const bus = new SimpleEventBus();
    const forwarded: unknown[] = [];
    setEventBusForwardTarget(() => ({
      send(channel: string, payload: unknown) {
        assert.equal(channel, IPC_CHANNELS.AGENT_STREAM);
        forwarded.push(payload);
      },
    }));
    attachEventBusForwarder(bus);

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
