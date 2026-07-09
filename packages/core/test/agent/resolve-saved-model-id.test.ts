import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveSavedModelId,
  resolveSummarySavedModelId,
} from "../../src/domain/agent/logic/resolve-saved-model-id.js";
import { resolveApplicationModelId } from "../../src/domain/agent/logic/resolve-application-model-id.js";

describe("resolveSavedModelId", () => {
  it("R1: prefers CLI flag over pin and workspace", () => {
    assert.equal(
      resolveSavedModelId({
        cliModelId: "zhipu/glm-4.6",
        agentModelId: "mock/test",
        workspaceModelId: "openai/gpt-4",
      }),
      "zhipu/glm-4.6",
    );
  });

  it("R1: falls back to agent model pin then workspace", () => {
    assert.equal(
      resolveSavedModelId({
        agentModelId: "mock/test",
        workspaceModelId: "openai/gpt-4",
      }),
      "mock/test",
    );
    assert.equal(
      resolveSavedModelId({ workspaceModelId: "openai/gpt-4" }),
      "openai/gpt-4",
    );
    assert.equal(resolveSavedModelId({}), undefined);
  });
});

describe("resolveSummarySavedModelId", () => {
  it("T6: prefers CLI, then summary pin, then workspace (not dialogue)", () => {
    assert.equal(
      resolveSummarySavedModelId({
        cliModelId: "flag/model",
        summaryModelId: "pin/model",
        workspaceModelId: "workspace/model",
      }),
      "flag/model",
    );
    assert.equal(
      resolveSummarySavedModelId({
        summaryModelId: "pin/model",
        workspaceModelId: "workspace/model",
      }),
      "pin/model",
    );
    assert.equal(
      resolveSummarySavedModelId({
        workspaceModelId: "workspace/model",
      }),
      "workspace/model",
    );
  });
});

describe("resolveApplicationModelId (deprecated alias)", () => {
  it("delegates to resolveSavedModelId", () => {
    assert.equal(
      resolveApplicationModelId({ workspaceModelId: "openai/gpt-4" }),
      "openai/gpt-4",
    );
  });
});
