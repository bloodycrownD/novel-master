import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { agentActivity } from "../src/main/runtime/agent-activity.js";

describe("agent-activity refcount", () => {
  afterEach(() => {
    while (agentActivity.isActive()) {
      agentActivity.decrement();
    }
  });

  it("increment 后 agentActivity.isActive 为 true", () => {
    agentActivity.increment();
    assert.equal(agentActivity.isActive(), true);
  });

  it("decrement 归零后幂等", () => {
    agentActivity.increment();
    agentActivity.decrement();
    assert.equal(agentActivity.isActive(), false);
    agentActivity.decrement();
    assert.equal(agentActivity.isActive(), false);
  });

  it("多次 decrement 不会下溢", () => {
    agentActivity.decrement();
    agentActivity.decrement();
    assert.equal(agentActivity.isActive(), false);
  });

  it("subscribe 在 0→1 与 1→0 时通知", () => {
    const events: boolean[] = [];
    const unsubscribe = agentActivity.subscribe((active) => {
      events.push(active);
    });

    agentActivity.increment();
    agentActivity.decrement();
    unsubscribe();

    assert.deepEqual(events, [true, false]);
  });

  it("decrement 幂等时不重复通知 false", () => {
    const events: boolean[] = [];
    const unsubscribe = agentActivity.subscribe((active) => {
      events.push(active);
    });

    agentActivity.increment();
    agentActivity.decrement();
    agentActivity.decrement();
    unsubscribe();

    assert.deepEqual(events, [true, false]);
  });
});
