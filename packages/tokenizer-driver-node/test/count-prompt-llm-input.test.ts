import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { type ChatMessage } from "@novel-master/core/chat";

import { type AgentPromptLayout, type PromptRenderContext } from "@novel-master/core/prompt";

import {
  CHARACTERS_PER_TOKEN_RATIO,
  countOpenAiStyleMessages,
  countPromptLlmInput,
  createDefaultTokenCounterRegistry,
  resolveContextWindowTokens,
  serializePromptLlmInput,
  serializeToolsForTokenCount,
  wrapSerializedPromptAsSystemMessage,
} from "@novel-master/core/provider";
import {
  countTextWithDefaultEncoding,
  getNodeEncodingByName,
  getNodeEncodingForModel,
} from "../src/impl/encoding-cache.js";
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

  it("T-FA3: model: 键废除后 gpt-4o/gpt-4 解析进 enc: 单键空间，与按名取用共享同一张表", () => {
    const for4o = getNodeEncodingForModel("gpt-4o");
    const for4 = getNodeEncodingForModel("gpt-4");
    const for35 = getNodeEncodingForModel("gpt-3.5-turbo");
    assert.notEqual(for4o, null);
    assert.notEqual(for4, null);
    assert.notEqual(for35, null);
    // 若 model: 双命名空间残留（或模型→编码名解析装错表），这里取到的是
    // 各自独立构造的另一张表实例，严格相等必红。
    assert.ok(for4o === getNodeEncodingByName("o200k_base"));
    assert.ok(for4 === getNodeEncodingByName("cl100k_base"));
    assert.ok(for35 === getNodeEncodingByName("cl100k_base"));
    assert.notEqual(for4o, for4);
  });

  it("T-FA3: gpt-4o 精确档读数与 o200k 表手工对拍一致（走对表而非 cl100k）", async () => {
    // 中文夹具：o200k 与 cl100k 对它的读数差异显著（实测 6 vs 11 token 级别），
    // 英文短句两表常同数、对拍无鉴别力。
    const { layout, ctx } = fixtureParams({
      systemContent: "你是一位严谨的小说编辑，请逐段审阅正文。",
      messages: [msg("user", "他把伞收了，窗外的雨顺着玻璃往下淌。")],
    });
    const serialized =
      (await serializePromptLlmInput(layout, ctx)) +
      serializeToolsForTokenCount(undefined);
    const o200k = getNodeEncodingByName("o200k_base");
    const cl100k = getNodeEncodingByName("cl100k_base");
    assert.notEqual(o200k, null);
    assert.notEqual(cl100k, null);
    // 夹具自检：两表对同一串的读数必须不同，否则下面的对拍没有鉴别力。
    assert.notEqual(
      o200k!.encode(serialized).length,
      cl100k!.encode(serialized).length,
      "夹具在 o200k / cl100k 下计数应不同，请更换夹具文本",
    );

    const result = await countPromptLlmInput({
      layout,
      ctx,
      savedModelId: "openai/gpt-4o",
      registry,
    });
    assert.equal(result.counterKind, "tiktoken");
    assert.equal(result.estimated, false);
    const expected = countOpenAiStyleMessages(
      o200k!,
      [wrapSerializedPromptAsSystemMessage(serialized)],
      "gpt-4o",
    );
    assert.equal(result.tokenCount, expected);
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
    // 3.35 是英文口径；cl100k 对中文约 1.64 token/字符（≈0.61 字符/token）。
    // 折算对中文正文低估 82%~84%，所以只要这条用例还能过，就说明兜底确实在跑
    // 真分词器。
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

/**
 * T-FA4（fallback-caliber-align Step 3）：WEB/SP 家族**词表资产加载失败**分支的
 * driver 层 counterKind 断言。
 *
 * 成功路径的 counterKind 断言上方已有（claude 用例）；impl 层的 estimated 断言在
 * fallback-count.test.ts。这里补的是「资产加载失败时 counterKind 必须降级为
 * heuristic」——改回谎报实现（`counterKind = family`）时 counterKind 会报成
 * 家族名，用例必红。
 *
 * 失败注入手段：向驱动注册一个不存在的 assetsRoot——web 家族的 `readJson` 与
 * SP 家族的 `.model` 加载都会 ENOENT（与 fallback-count.test.ts 的 F1/F2 同一
 * 条真实加载链，只是这里从 driver 层入口触发）。
 */
describe("WEB/SP 资产加载失败的 counterKind 降级（T-FA4）", () => {
  const badAssetsRoot = join(tmpdir(), "nm-no-such-tokenizer-assets");
  const registry = createDefaultTokenCounterRegistry({} as Record<string, never>);

  before(() => {
    registerTokenizerNodeDriverForTests();
  });

  it("W1: web 家族（claude）资产加载失败 → counterKind=heuristic + estimated=true", async () => {
    registerTokenizerNodeDriverForTests(badAssetsRoot);
    try {
      const { layout, ctx } = fixtureParams();
      const result = await countPromptLlmInput({
        layout,
        ctx,
        savedModelId: "openai/claude-3-5-sonnet",
        registry,
      });
      assert.equal(result.tokenizerFamily, "claude");
      // 读数已退到 cl100k 近似：counterKind 若仍报 "claude" 即为谎报，必红。
      assert.equal(result.counterKind, "heuristic");
      assert.equal(result.estimated, true);
      const serialized =
        (await serializePromptLlmInput(layout, ctx)) +
        serializeToolsForTokenCount(undefined);
      // 两级降级的第一级：真 cl100k 读数（非字符折算）。
      assert.equal(result.tokenCount, countTextWithDefaultEncoding(serialized));
    } finally {
      registerTokenizerNodeDriverForTests();
    }
  });

  it("S1: SP 家族（mistral）资产加载失败 → counterKind=heuristic + estimated=true", async () => {
    registerTokenizerNodeDriverForTests(badAssetsRoot);
    try {
      const { layout, ctx } = fixtureParams();
      const result = await countPromptLlmInput({
        layout,
        ctx,
        savedModelId: "openai/mistral-7b-instruct",
        registry,
      });
      assert.equal(result.tokenizerFamily, "mistral");
      assert.equal(result.counterKind, "heuristic");
      assert.equal(result.estimated, true);
      const serialized =
        (await serializePromptLlmInput(layout, ctx)) +
        serializeToolsForTokenCount(undefined);
      assert.equal(result.tokenCount, countTextWithDefaultEncoding(serialized));
    } finally {
      registerTokenizerNodeDriverForTests();
    }
  });
});
