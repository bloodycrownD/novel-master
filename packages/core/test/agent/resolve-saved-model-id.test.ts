import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveSavedModelId,
  resolveSummarySavedModelId,
} from "../../src/domain/agent/logic/resolve-saved-model-id.js";
import { resolveApplicationModelId } from "../../src/domain/agent/logic/resolve-application-model-id.js";

describe("resolveSavedModelId", () => {
  it("R1: prefers agent model pin over workspace", () => {
    assert.equal(
      resolveSavedModelId({
        agentModelId: "mock/test",
        workspaceModelId: "openai/gpt-4",
      }),
      "mock/test",
    );
  });

  it("R1: falls back to workspace when agent pin absent", () => {
    assert.equal(
      resolveSavedModelId({ workspaceModelId: "openai/gpt-4" }),
      "openai/gpt-4",
    );
    assert.equal(resolveSavedModelId({}), undefined);
  });
});

describe("resolveSummarySavedModelId", () => {
  it("T6: prefers summary pin, then workspace (not dialogue)", () => {
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
