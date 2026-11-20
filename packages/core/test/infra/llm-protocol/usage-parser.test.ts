import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  UsageParser  } from "../../../src/infra/llm-protocol/logic/usage-parser.js";

describe("usage-parser", () => {
  it("U1: UsageParser.parse(openai) standard JSON", () => {
    const usage = UsageParser.parse("openai", {
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    assert.deepEqual(usage, {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it("U2: UsageParser.parse(anthropic)", () => {
    const usage = UsageParser.parse("anthropic", {
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    assert.equal(usage?.promptTokens, 100);
    assert.equal(usage?.completionTokens, 20);
    assert.equal(usage?.totalTokens, 120);
  });

  it("U3: UsageParser.parse(gemini) minimal fixture", () => {
    const usage = UsageParser.parse("gemini", {
      usageMetadata: {
        promptTokenCount: 8,
        candidatesTokenCount: 4,
        totalTokenCount: 12,
      },
    });
    assert.deepEqual(usage, {
      promptTokens: 8,
      completionTokens: 4,
      totalTokens: 12,
    });
  });

  it("T-S2: UsageParser.parse(openai) 读 prompt_tokens_details.cached_tokens 到 cacheReadTokens", () => {
    const usage = UsageParser.parse("openai", {
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_tokens_details: { cached_tokens: 7 },
      },
    });
    assert.deepEqual(usage, {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cacheReadTokens: 7,
    });
  });

  it("T-S2: UsageParser.parse(openai) 无 cache 字段时返回不含 cache 二字段", () => {
    const usage = UsageParser.parse("openai", {
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    assert.ok(usage != null);
    assert.equal("cacheReadTokens" in usage, false);
    assert.equal("cacheCreationTokens" in usage, false);
  });

  it("B-1: UsageParser.parse(openai) 显式 cached_tokens: 0 → cacheReadTokens: 0（字段在场，非缺席）", () => {
    const usage = UsageParser.parse("openai", {
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    });
    assert.deepEqual(usage, {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cacheReadTokens: 0,
    });
  });

  it("B-1: UsageParser.parse(openai) 非有限数 / 负数仍视为字段缺席", () => {
    for (const bad of [-1, Number.POSITIVE_INFINITY, Number.NaN]) {
      const usage = UsageParser.parse("openai", {
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          prompt_tokens_details: { cached_tokens: bad },
        },
      });
      assert.ok(usage != null);
      assert.equal(
        "cacheReadTokens" in usage,
        false,
        `cached_tokens=${bad} 应视为字段缺席`,
      );
    }
  });

  it("T-S2: UsageParser.parse(anthropic) 读扁平 cache 字段", () => {
    const usage = UsageParser.parse("anthropic", {
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 60,
        cache_creation_input_tokens: 30,
      },
    });
    assert.equal(usage?.cacheReadTokens, 60);
    assert.equal(usage?.cacheCreationTokens, 30);
    assert.equal(usage?.totalTokens, 120);
  });

  it("T-S2: UsageParser.parse(anthropic) 兼容嵌套 cache_creation.input_tokens 形态", () => {
    const usage = UsageParser.parse("anthropic", {
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 60,
        cache_creation: { input_tokens: 30 },
      },
    });
    assert.equal(usage?.cacheReadTokens, 60);
    assert.equal(usage?.cacheCreationTokens, 30);
  });

  it("T-S2: UsageParser.parse(anthropic) 无 cache 字段时返回不含 cache 二字段", () => {
    const usage = UsageParser.parse("anthropic", {
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    assert.ok(usage != null);
    assert.equal("cacheReadTokens" in usage, false);
    assert.equal("cacheCreationTokens" in usage, false);
  });

  it("B-1: UsageParser.parse(anthropic) 显式 0 的 cache 两列 → 均为 0（字段在场，非缺席）", () => {
    const usage = UsageParser.parse("anthropic", {
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });
    assert.ok(usage != null);
    assert.equal(usage.cacheReadTokens, 0);
    assert.equal(usage.cacheCreationTokens, 0);
  });

  it("T-S2: UsageParser.parse(gemini) 读 cachedContentTokenCount 到 cacheReadTokens", () => {
    const usage = UsageParser.parse("gemini", {
      usageMetadata: {
        promptTokenCount: 8,
        candidatesTokenCount: 4,
        totalTokenCount: 12,
        cachedContentTokenCount: 6,
      },
    });
    assert.deepEqual(usage, {
      promptTokens: 8,
      completionTokens: 4,
      totalTokens: 12,
      cacheReadTokens: 6,
    });
  });

  it("T-S2: UsageParser.parse(gemini) 无 cache 字段时返回不含 cache 二字段", () => {
    const usage = UsageParser.parse("gemini", {
      usageMetadata: {
        promptTokenCount: 8,
        candidatesTokenCount: 4,
        totalTokenCount: 12,
      },
    });
    assert.ok(usage != null);
    assert.equal("cacheReadTokens" in usage, false);
    assert.equal("cacheCreationTokens" in usage, false);
  });

  it("B-1: UsageParser.parse(gemini) 显式 cachedContentTokenCount: 0 → cacheReadTokens: 0", () => {
    const usage = UsageParser.parse("gemini", {
      usageMetadata: {
        promptTokenCount: 8,
        candidatesTokenCount: 4,
        totalTokenCount: 12,
        cachedContentTokenCount: 0,
      },
    });
    assert.deepEqual(usage, {
      promptTokens: 8,
      completionTokens: 4,
      totalTokens: 12,
      cacheReadTokens: 0,
    });
  });
});
