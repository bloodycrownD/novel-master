import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyRegexRules,
  applyRegexToMessageContent,
  textBlocks,
} from "@novel-master/core";
import type { CompiledRegexRule } from "../../src/domain/regex/logic/compile-regex-rule.js";

function rule(
  partial: Partial<CompiledRegexRule> & Pick<CompiledRegexRule, "pattern">,
): CompiledRegexRule {
  return {
    llmReplace: null,
    displayReplace: null,
    startDepth: 0,
    endDepth: 99,
    scopeUser: true,
    scopeAssistant: true,
    ...partial,
  };
}

describe("applyRegexRules", () => {
  it("chains multiple rules in order", () => {
    const rules: CompiledRegexRule[] = [
      rule({
        pattern: /foo/,
        llmReplace: "bar",
        displayReplace: "baz",
      }),
      rule({
        pattern: /bar/,
        llmReplace: "qux",
        displayReplace: "qux",
      }),
    ];
    assert.equal(
      applyRegexRules("foo", rules, {
        channel: "llm",
        depthFromTail: 1,
        role: "user",
      }),
      "qux",
    );
  });

  it("respects tail depth range", () => {
    const rules: CompiledRegexRule[] = [
      rule({
        pattern: /x/,
        llmReplace: "Y",
        startDepth: 2,
        endDepth: 3,
      }),
    ];
    assert.equal(
      applyRegexRules("x", rules, {
        channel: "llm",
        depthFromTail: 1,
        role: "user",
      }),
      "x",
    );
    assert.equal(
      applyRegexRules("x", rules, {
        channel: "llm",
        depthFromTail: 2,
        role: "user",
      }),
      "Y",
    );
  });

  it("filters by role scope", () => {
    const rules: CompiledRegexRule[] = [
      rule({
        pattern: /hi/,
        llmReplace: "bye",
        scopeUser: true,
        scopeAssistant: false,
      }),
    ];
    assert.equal(
      applyRegexRules("hi", rules, {
        channel: "llm",
        depthFromTail: 0,
        role: "assistant",
      }),
      "hi",
    );
  });

  it("applies llm vs display replacement independently", () => {
    const rules: CompiledRegexRule[] = [
      rule({
        pattern: /secret/,
        llmReplace: "[redacted]",
        displayReplace: "***",
      }),
    ];
    assert.equal(
      applyRegexRules("secret", rules, {
        channel: "llm",
        depthFromTail: 0,
        role: "user",
      }),
      "[redacted]",
    );
    assert.equal(
      applyRegexRules("secret", rules, {
        channel: "display",
        depthFromTail: 0,
        role: "user",
      }),
      "***",
    );
  });

  it("supports capture group placeholders", () => {
    const rules: CompiledRegexRule[] = [
      rule({
        pattern: /(\w+)@(\w+)/,
        llmReplace: "$1 at $2",
      }),
    ];
    assert.equal(
      applyRegexRules("a@b", rules, {
        channel: "llm",
        depthFromTail: 0,
        role: "user",
      }),
      "a at b",
    );
  });

  it("applyRegexToMessageContent transforms text blocks only", () => {
    const rules: CompiledRegexRule[] = [
      rule({ pattern: /bad/, displayReplace: "ok" }),
    ];
    const out = applyRegexToMessageContent(textBlocks("bad word"), rules, {
      channel: "display",
      depthFromTail: 0,
      role: "user",
    });
    assert.equal(out.blocks[0]!.type === "text" && out.blocks[0]!.text, "ok word");
  });
});
