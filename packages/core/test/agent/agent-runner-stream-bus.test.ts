import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
  EVENT_AGENT_STREAM_TOOL_USE_DELTA,
} from "../../src/domain/events/model/event-types.js";
import { SimpleEventBus } from "../../src/infra/events/simple-event-bus.js";
import { wrapStreamForBus } from "../../src/service/agent/impl/agent-runner.js";

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
    bus.subscribe(EVENT_AGENT_STREAM_TOOL_USE_DELTA, () => {
      published.push("tool-use-delta");
    });

    const onStream = wrapStreamForBus(bus, sessionId, () => {
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
    onStream!({
      type: "tool-use-delta",
      id: "t1",
      name: "read",
      delta: '{"path":',
    });
    assert.equal(published.length, 0);

    await Promise.resolve();
    assert.deepEqual(published, [
      "text-delta",
      "thinking-delta",
      "tool-use",
      "tool-use-delta",
    ]);
  });

  it("defers bus.publish when no userOnStream callback", async () => {
    const bus = new SimpleEventBus();
    const published: string[] = [];

    bus.subscribe(EVENT_AGENT_STREAM_TEXT_DELTA, () => {
      published.push("text-delta");
    });

    const onStream = wrapStreamForBus(bus, "sess-2");
    assert.ok(onStream);

    onStream!({ type: "text-delta", text: "x" });
    assert.equal(published.length, 0);

    await Promise.resolve();
    assert.deepEqual(published, ["text-delta"]);
  });
});
