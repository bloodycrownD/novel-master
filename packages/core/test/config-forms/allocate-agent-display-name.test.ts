import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allocateAgentDisplayName } from "../../src/config-forms/agent/allocate-agent-display-name.js";

describe("allocateAgentDisplayName", () => {
  it("空列表时返回 agent1", () => {
    assert.equal(allocateAgentDisplayName([]), "agent1");
  });

  it("跳过已占用的序号", () => {
    assert.equal(
      allocateAgentDisplayName([
        { id: "a", name: "agent1" },
        { id: "b", name: "agent3" },
      ]),
      "agent2",
    );
  });

  it("比较显示名时 trim 空白", () => {
    assert.equal(
      allocateAgentDisplayName([{ id: "a", name: "  agent1  " }]),
      "agent2",
    );
  });

  it("忽略空白显示名", () => {
    assert.equal(
      allocateAgentDisplayName([{ id: "a", name: "   " }]),
      "agent1",
    );
  });
});
