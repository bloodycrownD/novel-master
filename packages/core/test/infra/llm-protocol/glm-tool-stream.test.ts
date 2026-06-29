import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isGlmToolStreamModel } from "../../../src/infra/llm-protocol/logic/glm-tool-stream.js";

describe("isGlmToolStreamModel", () => {
  it("T1: glm-5.2 为 true", () => {
    assert.equal(isGlmToolStreamModel("glm-5.2"), true);
  });

  it("glm-4.6 / glm-4.7 系列为 true", () => {
    assert.equal(isGlmToolStreamModel("glm-4.6"), true);
    assert.equal(isGlmToolStreamModel("glm-4.7"), true);
    assert.equal(isGlmToolStreamModel("GLM-4.7-Flash"), true);
    assert.equal(isGlmToolStreamModel("models/glm-5"), true);
    assert.equal(isGlmToolStreamModel("glm-5-preview"), true);
  });

  it("T2: 非 GLM 4.6/4.7/5 型号为 false", () => {
    assert.equal(isGlmToolStreamModel("gpt-4o"), false);
    assert.equal(isGlmToolStreamModel("glm-4-flash"), false);
    assert.equal(isGlmToolStreamModel("claude-3-5-sonnet"), false);
  });
});
