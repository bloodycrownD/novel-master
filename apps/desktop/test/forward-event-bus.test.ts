import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EVENT_AGENT_STREAM_TEXT_DELTA,
  SimpleEventBus,
} from "@novel-master/core";
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
});
