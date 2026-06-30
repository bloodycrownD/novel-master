import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  decrementDesktopAgentActive,
  incrementDesktopAgentActive,
  isDesktopAgentActive,
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
});
