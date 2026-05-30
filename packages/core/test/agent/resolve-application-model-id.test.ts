import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveApplicationModelId,
  resolveSummaryApplicationModelId,
} from "@novel-master/core";

describe("resolveApplicationModelId", () => {
  it("R1: prefers CLI flag over pin and workspace", () => {
    assert.equal(
      resolveApplicationModelId({
        cliModelId: "zhipu/glm-4.6",
        agentModelId: "mock/test",
        workspaceModelId: "openai/gpt-4",
      }),
      "zhipu/glm-4.6",
    );
  });

  it("R1: falls back to agent model pin then workspace", () => {
    assert.equal(
      resolveApplicationModelId({
        agentModelId: "mock/test",
        workspaceModelId: "openai/gpt-4",
      }),
      "mock/test",
    );
    assert.equal(
      resolveApplicationModelId({ workspaceModelId: "openai/gpt-4" }),
      "openai/gpt-4",
    );
    assert.equal(resolveApplicationModelId({}), undefined);
  });
});

describe("resolveSummaryApplicationModelId", () => {
  it("T6: prefers CLI, then summary pin, then workspace (not dialogue)", () => {
    assert.equal(
      resolveSummaryApplicationModelId({
        cliModelId: "flag/model",
        summaryModelId: "pin/model",
        workspaceModelId: "workspace/model",
      }),
      "flag/model",
    );
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
