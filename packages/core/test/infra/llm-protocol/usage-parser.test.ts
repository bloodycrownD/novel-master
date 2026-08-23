import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseAnthropicUsage,
  parseGeminiUsage,
  parseOpenAiUsage,
} from "../../../src/infra/llm-protocol/logic/usage-parser.js";

describe("usage-parser", () => {
  it("U1: parseOpenAiUsage standard JSON", () => {
    const usage = parseOpenAiUsage({
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    assert.deepEqual(usage, {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it("U2: parseAnthropicUsage", () => {
    const usage = parseAnthropicUsage({
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    assert.equal(usage?.promptTokens, 100);
    assert.equal(usage?.completionTokens, 20);
    assert.equal(usage?.totalTokens, 120);
  });

  it("U3: parseGeminiUsage minimal fixture", () => {
    const usage = parseGeminiUsage({
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

  it("T-S2: parseOpenAiUsage 读 prompt_tokens_details.cached_tokens 到 cacheReadTokens", () => {
    const usage = parseOpenAiUsage({
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

  it("T-S2: parseOpenAiUsage 无 cache 字段时返回不含 cache 二字段", () => {
    const usage = parseOpenAiUsage({
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    assert.ok(usage != null);
    assert.equal("cacheReadTokens" in usage, false);
    assert.equal("cacheCreationTokens" in usage, false);
  });

  it("T-S2: parseAnthropicUsage 读扁平 cache 字段", () => {
    const usage = parseAnthropicUsage({
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

  it("T-S2: parseAnthropicUsage 兼容嵌套 cache_creation.input_tokens 形态", () => {
    const usage = parseAnthropicUsage({
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

  it("T-S2: parseAnthropicUsage 无 cache 字段时返回不含 cache 二字段", () => {
    const usage = parseAnthropicUsage({
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    assert.ok(usage != null);
    assert.equal("cacheReadTokens" in usage, false);
    assert.equal("cacheCreationTokens" in usage, false);
  });

  it("T-S2: parseGeminiUsage 读 cachedContentTokenCount 到 cacheReadTokens", () => {
    const usage = parseGeminiUsage({
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

  it("T-S2: parseGeminiUsage 无 cache 字段时返回不含 cache 二字段", () => {
    const usage = parseGeminiUsage({
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
});
