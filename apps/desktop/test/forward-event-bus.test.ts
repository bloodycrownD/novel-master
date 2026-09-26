import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EVENT_AGENT_STREAM_TEXT_DELTA, EVENT_AGENT_STREAM_USAGE, SimpleEventBus } from "@novel-master/core/events";
import {
  attachEventBusForwarder,
  setEventBusForwardTarget,
} from "../src/main/ipc/forward-event-bus.js";
import { IPC_CHANNELS } from "../shared/ipc-types.js";

describe("forward-event-bus", () => {
  it("double attach does not double-forward events", () => {
    const bus = new SimpleEventBus();
    const forwarded: unknown[] = [];

    setEventBusForwardTarget(() => ({
      send(channel: string, payload: unknown) {
        assert.equal(channel, IPC_CHANNELS.AGENT_STREAM);
        forwarded.push(payload);
      },
    }));

    attachEventBusForwarder(bus);
    attachEventBusForwarder(bus);

    bus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
      sessionId: "s1",
      text: "hello",
    });

    assert.equal(forwarded.length, 1);
  });

  it("T-M4: FORWARDED_EVENTS 清单含流中 usage 事件，run 级 completionTokens 原样转发", () => {
    const bus = new SimpleEventBus();
    const forwarded: Array<{ type: string; payload: unknown }> = [];

    setEventBusForwardTarget(() => ({
      send(channel: string, payload: unknown) {
        assert.equal(channel, IPC_CHANNELS.AGENT_STREAM);
        forwarded.push(payload as { type: string; payload: unknown });
      },
    } as never));

    attachEventBusForwarder(bus);

    bus.publish(EVENT_AGENT_STREAM_USAGE, {
      sessionId: "s1",
      runId: "r1",
      completionTokens: 123,
      source: "usage",
    });

    assert.equal(forwarded.length, 1);
    assert.equal(forwarded[0]!.type, "agent.stream.usage");
    assert.deepEqual(forwarded[0]!.payload, {
      sessionId: "s1",
      runId: "r1",
      completionTokens: 123,
      source: "usage",
    });
  });
});
