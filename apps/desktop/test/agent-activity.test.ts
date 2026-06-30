import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  decrementDesktopAgentActive,
  incrementDesktopAgentActive,
  isDesktopAgentActive,
  subscribeDesktopAgentActivity,
} from "../src/main/runtime/agent-activity.js";

describe("agent-activity refcount", () => {
  afterEach(() => {
    while (isDesktopAgentActive()) {
      decrementDesktopAgentActive();
    }
  });

  it("increment 后 isDesktopAgentActive 为 true", () => {
    incrementDesktopAgentActive();
    assert.equal(isDesktopAgentActive(), true);
  });

  it("decrement 归零后幂等", () => {
    incrementDesktopAgentActive();
    decrementDesktopAgentActive();
    assert.equal(isDesktopAgentActive(), false);
    decrementDesktopAgentActive();
    assert.equal(isDesktopAgentActive(), false);
  });

  it("多次 decrement 不会下溢", () => {
    decrementDesktopAgentActive();
    decrementDesktopAgentActive();
    assert.equal(isDesktopAgentActive(), false);
  });

  it("subscribe 在 0→1 与 1→0 时通知", () => {
    const events: boolean[] = [];
    const unsubscribe = subscribeDesktopAgentActivity((active) => {
      events.push(active);
    });

    incrementDesktopAgentActive();
    decrementDesktopAgentActive();
    unsubscribe();

    assert.deepEqual(events, [true, false]);
  });

  it("decrement 幂等时不重复通知 false", () => {
    const events: boolean[] = [];
    const unsubscribe = subscribeDesktopAgentActivity((active) => {
      events.push(active);
    });

    incrementDesktopAgentActive();
    decrementDesktopAgentActive();
    decrementDesktopAgentActive();
    unsubscribe();

    assert.deepEqual(events, [true, false]);
  });
});
