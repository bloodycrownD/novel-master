import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { agentActivity } from "../src/main/runtime/agent-activity.js";
import { AgentActivityForwarder } from "../src/main/ipc/forward-agent-activity.js";
import { IPC_CHANNELS } from "../shared/ipc-types.js";

describe("forward-agent-activity", () => {
  afterEach(() => {
    while (agentActivity.isActive()) {
      agentActivity.decrement();
    }
  });

  it("refcount 变化时向 renderer 推送 AGENT_ACTIVITY", () => {
    const payloads: Array<{ active: boolean }> = [];
    AgentActivityForwarder.setTarget(() => ({
      send(channel: string, payload: unknown) {
        assert.equal(channel, IPC_CHANNELS.AGENT_ACTIVITY);
        payloads.push(payload as { active: boolean });
      },
    }));
    const detach = AgentActivityForwarder.attach();

    agentActivity.increment();
    agentActivity.decrement();
    detach();

    assert.deepEqual(payloads, [{ active: true }, { active: false }]);
  });
});
