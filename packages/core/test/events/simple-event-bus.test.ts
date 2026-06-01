import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SimpleEventBus } from "../../src/infra/events/simple-event-bus.js";

describe("SimpleEventBus", () => {
  it("subscribe and publish to multiple handlers", () => {
    const bus = new SimpleEventBus();
    const seen: number[] = [];
    bus.subscribe("test", () => seen.push(1));
    bus.subscribe("test", () => seen.push(2));
    bus.publish("test", { x: 1 });
    assert.deepEqual(seen, [1, 2]);
  });

  it("unsubscribe stops delivery", () => {
    const bus = new SimpleEventBus();
    let n = 0;
    const sub = bus.subscribe("test", () => {
      n += 1;
    });
    bus.publish("test", {});
    sub.unsubscribe();
    bus.publish("test", {});
    assert.equal(n, 1);
  });
});
