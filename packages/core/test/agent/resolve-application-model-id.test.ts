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
        preferredModelId: "mock/test",
        workspaceModelId: "openai/gpt-4",
      }),
      "zhipu/glm-4.6",
    );
  });

  it("R1: falls back to preferredModelId then workspace", () => {
    assert.equal(
      resolveApplicationModelId({
        preferredModelId: "mock/test",
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
  it("R2: prefers CLI, then summary pin, then dialogue id", () => {
    assert.equal(
      resolveSummaryApplicationModelId({
        cliModelId: "flag/model",
        summaryPreferredModelId: "pin/model",
        dialogueApplicationModelId: "dialogue/model",
      }),
      "flag/model",
    );
    assert.equal(
      resolveSummaryApplicationModelId({
        summaryPreferredModelId: "pin/model",
        dialogueApplicationModelId: "dialogue/model",
      }),
      "pin/model",
    );
    assert.equal(
      resolveSummaryApplicationModelId({
        dialogueApplicationModelId: "dialogue/model",
      }),
      "dialogue/model",
    );
  });
});
