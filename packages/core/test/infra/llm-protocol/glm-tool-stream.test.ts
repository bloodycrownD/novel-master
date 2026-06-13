import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isGlmToolStreamModel } from "../../../src/infra/llm-protocol/logic/glm-tool-stream.js";

describe("isGlmToolStreamModel", () => {
  it("匹配 GLM 4.6 / 4.7 / 5 系列（不区分大小写，允许 models/ 前缀）", () => {
    const matched = [
      "glm-4.6",
      "GLM-4.6",
      "glm-4.7",
      "GLM-4.7-Flash",
      "models/glm-4.7",
      "glm-5",
      "GLM-5-Air",
      "models/glm-5",
    ];
    for (const id of matched) {
      assert.equal(isGlmToolStreamModel(id), true, id);
    }
  });

  it("不匹配非 GLM 或旧版型号", () => {
    const unmatched = ["gpt-4o", "glm-4", "glm-4.5", "claude-3-5-sonnet"];
    for (const id of unmatched) {
      assert.equal(isGlmToolStreamModel(id), false, id);
    }
  });
});
