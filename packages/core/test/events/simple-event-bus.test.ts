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

  it("T-BUS-1: handler A throws, handler B still runs", () => {
    const bus = new SimpleEventBus({ onHandlerError: () => undefined });
    const seen: string[] = [];
    bus.subscribe("test", () => {
      throw new Error("A");
    });
    bus.subscribe("test", () => seen.push("B"));
    bus.publish("test", {});
    assert.deepEqual(seen, ["B"]);
  });

  it("T-BUS-2: onHandlerError is invoked on sync throw", () => {
    const errors: unknown[] = [];
    const reporting = new SimpleEventBus({
      onHandlerError: (_type, err) => errors.push(err),
    });
    reporting.subscribe("evt", () => {
      throw new Error("boom");
    });
    reporting.publish("evt", {});
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /boom/);
  });
});