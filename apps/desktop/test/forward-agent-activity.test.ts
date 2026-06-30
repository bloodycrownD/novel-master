import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  decrementDesktopAgentActive,
  incrementDesktopAgentActive,
  isDesktopAgentActive,
} from "../src/main/runtime/agent-activity.js";
import {
  attachAgentActivityForwarder,
  setAgentActivityForwardTarget,
} from "../src/main/ipc/forward-agent-activity.js";
import { IPC_CHANNELS } from "../shared/ipc-types.js";

describe("forward-agent-activity", () => {
  afterEach(() => {
    while (isDesktopAgentActive()) {
      decrementDesktopAgentActive();
    }
  });

  it("refcount 变化时向 renderer 推送 AGENT_ACTIVITY", () => {
    const payloads: Array<{ active: boolean }> = [];
    setAgentActivityForwardTarget(() => ({
      send(channel: string, payload: unknown) {
        assert.equal(channel, IPC_CHANNELS.AGENT_ACTIVITY);
        payloads.push(payload as { active: boolean });
      },
    }));
    const detach = attachAgentActivityForwarder();

    incrementDesktopAgentActive();
    decrementDesktopAgentActive();
    detach();

    assert.deepEqual(payloads, [{ active: true }, { active: false }]);
  });
});
