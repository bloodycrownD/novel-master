import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveApplicationModelId, resolveSummaryApplicationModelId } from "@novel-master/core/agent";

describe("resolveApplicationModelId", () => {
  it("R1: prefers agent model pin over workspace", () => {
    assert.equal(
      resolveApplicationModelId({
        agentModelId: "mock/test",
        workspaceModelId: "openai/gpt-4",
      }),
      "mock/test",
    );
  });

  it("R1: falls back to workspace when agent pin absent", () => {
    assert.equal(
      resolveApplicationModelId({ workspaceModelId: "openai/gpt-4" }),
      "openai/gpt-4",
    );
    assert.equal(resolveApplicationModelId({}), undefined);
  });
});

describe("resolveSummaryApplicationModelId", () => {
  it("T6: prefers summary pin, then workspace (not dialogue)", () => {
    assert.equal(
      resolveSummaryApplicationModelId({
        summaryModelId: "pin/model",
        workspaceModelId: "workspace/model",
      }),
      "pin/model",
    );
    assert.equal(
      resolveSummaryApplicationModelId({
        workspaceModelId: "workspace/model",
      }),
      "workspace/model",
    );
  });
});
