import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { type ChatMessage } from "@novel-master/core/chat";

import { type AgentPromptLayout, type PromptRenderContext } from "@novel-master/core/prompt";

import {
  CHARACTERS_PER_TOKEN_RATIO,
  countPromptLlmInput,
  createDefaultTokenCounterRegistry,
  resolveContextWindowTokens,
  serializePromptLlmInput,
  serializeToolsForTokenCount,
} from "@novel-master/core/provider";
import { countTextWithDefaultEncoding } from "../src/impl/encoding-cache.js";
import { registerTokenizerNodeDriverForTests } from "../src/register-for-tests.js";

function emptyRegistryDeps(): Record<string, never> {
  return {};
}

function msg(role: ChatMessage["role"], text: string): ChatMessage {
  return {
    id: "1",
    sessionId: "s",
    seq: 1,
    role,
    content: { blocks: [{ type: "text", text }] },
    hidden: false,
    createdAtMs: 0,
  };
}

function fixtureParams(overrides?: {
  readonly systemContent?: string;
  readonly messages?: readonly ChatMessage[];
}): {
  readonly layout: AgentPromptLayout;
  readonly ctx: PromptRenderContext;
} {
  const systemContent = overrides?.systemContent ?? "You are helpful.";
  const messages = overrides?.messages ?? [msg("user", "Hello")];
  return {
    layout: {
      system: systemContent,
      persist: [],
      dynamic: [],
    },
    ctx: {
      workplaceDisplay: "",
      messages,
    },
  };
}

describe("countPromptLlmInput", () => {
  before(() => {
    registerTokenizerNodeDriverForTests();
  });

  const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());

  it("C1: stable count for same input and model", async () => {
    const { layout, ctx } = fixtureParams();
    const a = await countPromptLlmInput({
      layout,
      ctx,
      savedModelId: "openai/gpt-4o",
      registry,
    });
    const b = await countPromptLlmInput({
      layout,
      ctx,
      savedModelId: "openai/gpt-4o",
      registry,
    });
    assert.equal(a.tokenCount, b.tokenCount);
    assert.equal(a.counterKind, "tiktoken");
  });

  it("C2: larger system increases token count", async () => {
    const base = await countPromptLlmInput({
      ...fixtureParams(),
      savedModelId: "openai/gpt-4o",
      registry,
    });
    const larger = await countPromptLlmInput({
      ...fixtureParams({ systemContent: "You are helpful. ".repeat(20) }),
      savedModelId: "openai/gpt-4o",
      registry,
    });
    assert.ok(larger.tokenCount > base.tokenCount);
  });

  it("claude model on openai provider uses claude family", async () => {
    const result = await countPromptLlmInput({
      ...fixtureParams(),
      savedModelId: "openai/claude-3-5-sonnet",
      registry,
    });
    assert.equal(result.tokenizerFamily, "claude");
    assert.equal(result.counterKind, "claude");
    assert.ok(result.tokenCount > 0);
  });

  it("unknown model uses heuristic", async () => {
    const { layout, ctx } = fixtureParams();
    const result = await countPromptLlmInput({
      layout,
      ctx,
      savedModelId: "openai/my-custom/foo",
      registry,
    });
    assert.equal(result.tokenizerFamily, "heuristic");
    assert.equal(result.counterKind, "heuristic");
    assert.equal(result.estimated, true);
    // stream-metrics-native ④：兜底档的读数已是**真 cl100k 计数**，不再是
    // `ceil(chars / 3.35)`。这里逐字对齐断言，把「换了口径」钉死在用例里——
    // 只断言 counterKind 的话，将来有人改回折算这个用例会全绿。
    const serialized =
      (await serializePromptLlmInput(layout, ctx)) +
      serializeToolsForTokenCount(undefined);
    const real = countTextWithDefaultEncoding(serialized);
    assert.notEqual(real, null);
    assert.equal(result.tokenCount, real);
    assert.notEqual(
      result.tokenCount,
      Math.ceil(serialized.length / CHARACTERS_PER_TOKEN_RATIO),
    );
  });

  it("中文兜底读数远大于字符折算（钉住真分词器真的接上了）", async () => {
    // 3.35 是英文口径；cl100k 对中文约 1.64 字符/token。折算对中文正文低估
    // 82%~84%，所以只要这条用例还能过，就说明兜底确实在跑真分词器。
    const cn = "他把伞收了，窗外的雨顺着玻璃往下淌，街灯在水洼里碎成一片橙。".repeat(
      20,
    );
    const { layout, ctx } = fixtureParams({ systemContent: cn });
    const result = await countPromptLlmInput({
      layout,
      ctx,
      savedModelId: "openai/my-custom/foo",
      registry,
    });
    const serialized =
      (await serializePromptLlmInput(layout, ctx)) +
      serializeToolsForTokenCount(undefined);
    const charRatio = Math.ceil(serialized.length / CHARACTERS_PER_TOKEN_RATIO);

    assert.equal(result.counterKind, "heuristic");
    assert.equal(result.estimated, true);
    assert.equal(result.tokenCount, countTextWithDefaultEncoding(serialized));
    // 阈值取 3 倍：实测中文段约 5.2 倍，留足余量又不至于被小改动误伤。
    assert.ok(
      result.tokenCount > charRatio * 3,
      `真计数 ${result.tokenCount} 应远大于字符折算 ${charRatio}`,
    );
  });
});

describe("resolveContextWindowTokens", () => {
  it("W1: claude-3-5-sonnet → 200000", () => {
    assert.equal(resolveContextWindowTokens("claude-3-5-sonnet"), 200_000);
  });
});
