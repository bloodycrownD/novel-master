import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { updateRegexRuleSchema } from "@/domain/regex/model/regex-rule.schema.js";

describe("updateRegexRuleSchema depth normalize", () => {
  it("kebab-case patch 映射为 startDepth", () => {
    const parsed = updateRegexRuleSchema.parse({ "start-depth": 2 });
    assert.equal(parsed.startDepth, 2);
    assert.equal(parsed.endDepth, undefined);
    assert.equal("start-depth" in parsed, false);
  });

  it("kebab-case patch 映射为 endDepth", () => {
    const parsed = updateRegexRuleSchema.parse({ "end-depth": 5 });
    assert.equal(parsed.startDepth, undefined);
    assert.equal(parsed.endDepth, 5);
  });

  it("camelCase 与 kebab-case 同时存在时以 wire 解析为准", () => {
    const parsed = updateRegexRuleSchema.parse({
      "start-depth": 2,
      "end-depth": 8,
    });
    assert.equal(parsed.startDepth, 2);
    assert.equal(parsed.endDepth, 8);
  });
});
