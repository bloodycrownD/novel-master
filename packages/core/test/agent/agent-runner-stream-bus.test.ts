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

describe("agent-runner stream bus", () => {
  it("defers STREAM_* bus.publish via queueMicrotask", async () => {
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

    const onStream = wrapStreamForBus(bus, sessionId, RUN_ID, () => {
      userCalled = true;
      assert.equal(published.length, 0, "bus.publish must not run synchronously");
    });
    assert.ok(onStream);

    onStream!({ type: "text-delta", text: "hi" });
    assert.equal(userCalled, true);
    assert.equal(published.length, 0);

    onStream!({ type: "thinking-delta", text: "think" });
    onStream!({
      type: "tool-use",
      id: "t1",
      name: "read",
      input: { path: "a.txt" },
    });
    assert.equal(published.length, 0);

    await Promise.resolve();
    assert.deepEqual(published, [
      "text-delta",
      "thinking-delta",
      "tool-use",
    ]);
  });

  it("defers bus.publish when no userOnStream callback", async () => {
    const bus = new SimpleEventBus();
    const published: string[] = [];

    bus.subscribe(EVENT_AGENT_STREAM_TEXT_DELTA, () => {
      published.push("text-delta");
    });

    const onStream = wrapStreamForBus(bus, "sess-2", RUN_ID);
    assert.ok(onStream);

    onStream!({ type: "text-delta", text: "x" });
    assert.equal(published.length, 0);

    await Promise.resolve();
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

    await Promise.resolve();

    assert.equal(payloads.length, 3);
    for (const p of payloads) {
      assert.equal(p.sessionId, sessionId);
      assert.equal(p.runId, RUN_ID);
    }
  });
});
