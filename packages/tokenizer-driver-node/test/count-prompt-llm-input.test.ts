import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { type ChatMessage } from "@novel-master/core/chat";

import { type AgentPromptLayout, type PromptRenderContext } from "@novel-master/core/prompt";

import {
  CHARACTERS_PER_TOKEN_RATIO,
  chunkHash16,
  countOpenAiStyleMessages,
  countPromptLlmInput,
  countTextWithIncrementalTokenizer,
  createDefaultTokenCounterRegistry,
  promptWholeCache,
  resolveContextWindowTokens,
  serializePromptLlmInput,
  serializeToolsForTokenCount,
  splitTextIntoChunks,
  tokenChunkCache,
  wrapSerializedPromptAsSystemMessage,
} from "@novel-master/core/provider";
import {
  __setNodeEncodingFactoryForTests,
  clearNodeEncodingCacheForTests,
  countTextWithDefaultEncoding,
  getDefaultNodeEncoding,
  getNodeEncodingByName,
  getNodeEncodingForModel,
} from "../src/impl/encoding-cache.js";
import {
  createNodeTokenizerLoader,
  defaultTokenizerAssetsRoot,
  setNodeTokenizerLoader,
} from "../src/node-tokenizer-loader.js";
import { registerTokenizerNodeDriverForTests } from "../src/register-for-tests.js";

/**
 * 与驱动 `countOpenAiStyleChunked` 同构的分块口径组装（测试侧独立书写）：
 * overhead 走 core 原函数对**空 content** 求得 + splitTextIntoChunks 块逐个
 * 增量计数求和。T-FA2 的整串逐字节基准已按 spec 时序迁移至本口径
 * （message-token-cache Step 3 / T-TC5）。
 */
function chunkedExpectation(
  encoding: { encode(text: string): { readonly length: number } },
  serialized: string,
  tiktokenModel: string,
): number {
  const overhead = countOpenAiStyleMessages(
    encoding,
    [wrapSerializedPromptAsSystemMessage("")],
    tiktokenModel,
  );
  return overhead + chunkedTextSum(encoding, serialized);
}

/**
 * 兜底档（heuristic 家族 / 资产失败降级）的分块口径期望：**纯文本块和**、
 * 无 OpenAI 消息包装 overhead（兜底路径不套 countOpenAiStyleMessages）。
 */
function chunkedTextSum(
  encoding: { encode(text: string): { readonly length: number } },
  serialized: string,
): number {
  let chunkSum = 0;
  for (const chunk of splitTextIntoChunks(serialized)) {
    chunkSum += countTextWithIncrementalTokenizer(
      (text) => encoding.encode(text).length,
      chunk,
    );
  }
  return chunkSum;
}

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

  beforeEach(() => {
    // L1/L2 是进程级单例：跨用例存活会把「前面用例的正常路径结果」喂给
    // 「资产失败注入」之类的故障用例（T-FA4 W1 实测被 L1 命中谎报 claude），
    // 每个用例前清空，保证各用例从冷缓存起跑。
    promptWholeCache.clearForTests();
    tokenChunkCache.clearForTests();
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
    // message-token-cache Step 3（T-TC5 迁移注记）：encode 包分块 + 驱动 L2
    // 块流程后，精确档数值从「整串」变「分块加和」。T-FA2 的逐字节基准已按
    // spec 时序迁移至本步口径——期望改为分块组装（同构对拍：overhead 空串
    // 经 core 原函数 + 块逐个增量计数求和）。注意小夹具（数十字符）分块 vs
    // 整串差可到 ~2%（本例 48 vs 47），spec 的 ≤1% 验收线针对正常体量正文。
    const expected = chunkedExpectation(o200k!, serialized, "gpt-4o");
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
    // message-token-cache Step 3（T-TC5 迁移注记）：兜底档挂 L2 块流程后，
    // 期望从整串 countTextWithDefaultEncoding 迁移为分块组装（英文小夹具
    // 分块 vs 整串差 1 token，10 vs 9）。
    const serialized =
      (await serializePromptLlmInput(layout, ctx)) +
      serializeToolsForTokenCount(undefined);
    const real = countTextWithDefaultEncoding(serialized);
    assert.notEqual(real, null);
    const defaultEncoding = getDefaultNodeEncoding();
    assert.notEqual(defaultEncoding, null);
    assert.equal(result.tokenCount, chunkedTextSum(defaultEncoding!, serialized));
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
    // 同 T-TC5 迁移注记：兜底档走分块口径的**纯文本块和**（无消息包装
    // overhead；cl100k 对纯中文按字符独立切词，标点边界切分基本无损）。
    const cnEncoding = getDefaultNodeEncoding();
    assert.notEqual(cnEncoding, null);
    assert.equal(
      result.tokenCount,
      chunkedTextSum(cnEncoding!, serialized),
    );
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

  beforeEach(() => {
    // 同上：L1 进程级单例跨用例存活会把「正常资产路径」的结果喂给故障注入
    // 用例（本组 W1 实测被前面用例的 L1 条目命中、谎报 claude）。
    promptWholeCache.clearForTests();
    tokenChunkCache.clearForTests();
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

/**
 * T-TC5（message-token-cache Step 3）：驱动层 L1/L2 缓存的 encode / 文件读
 * 调用计数断言。计数断言一律用「缓存全命中时 baseEncode 调用 0 次」这类
 * 口径——spec 注记明确：单块进入增量计数器后内部仍可能按自然边界二切甚至
 * 多切，**不得**断言「单块 = 恰好 1 次 encode」（本组局部性用例用无标点
 * 连续中文夹具把变化块内部钉在 1 段，是夹具层面的控制，不是对切分行为的
 * 断言）。
 */
describe("T-TC5 驱动缓存（message-token-cache Step 3）", () => {
  const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());

  before(() => {
    registerTokenizerNodeDriverForTests();
  });

  beforeEach(() => {
    promptWholeCache.clearForTests();
    tokenChunkCache.clearForTests();
  });

  afterEach(() => {
    // recording 表注入还原：工厂回真实现 + 作废已缓存的假表。
    __setNodeEncodingFactoryForTests(null);
    clearNodeEncodingCacheForTests();
  });

  /** recording 注入：假表按字符数计，并统计 baseEncode 调用次数。 */
  function installRecordingEncoding(): { calls(): number } {
    let encodeCalls = 0;
    __setNodeEncodingFactoryForTests(
      () =>
        ({
          encode: (text: string) => {
            encodeCalls += 1;
            return { length: text.length };
          },
        }) as never,
    );
    clearNodeEncodingCacheForTests();
    return { calls: () => encodeCalls };
  }

  it("tiktoken 档：同输入两次计数，第二次 baseEncode 调用 0 次（L1 命中）", async () => {
    const recording = installRecordingEncoding();
    const { layout, ctx } = fixtureParams({
      systemContent: "夜色连成一片的无边幕布压在城市上空",
      messages: [msg("user", "他把伞收了窗外的雨顺着玻璃往下淌")],
    });
    const params = { layout, ctx, savedModelId: "openai/gpt-4o", registry };

    const first = await countPromptLlmInput(params);
    assert.equal(first.counterKind, "tiktoken");
    const callsAfterFirst = recording.calls();
    assert.ok(callsAfterFirst > 0, "夹具自检：首次计数必须真的调过 baseEncode");

    const second = await countPromptLlmInput(params);
    assert.equal(second.tokenCount, first.tokenCount);
    assert.equal(second.counterKind, first.counterKind);
    assert.equal(second.estimated, first.estimated);
    assert.equal(
      recording.calls(),
      callsAfterFirst,
      "L1 命中：同输入第二次不得再调 baseEncode（连 overhead 的 role encode 都不进）",
    );
  });

  it("tiktoken 档：改一条消息后仅变化块重算（新增 encode 调用 = 变化块数 + 1 次 role encode）", async () => {
    const recording = installRecordingEncoding();
    // 无标点连续中文：splitTextIntoChunks 走 64 硬切、块内无任何自然边界，
    // 增量计数器对每块恰好 1 次 encode——这是夹具控制，把「块数」与「调用
    // 数」钉成线性关系（夹具若引入标点/空白，块内会被二切，断言口径见
    // spec 注记）。
    const baseText =
      "这是一段完全没有标点与空白的连续中文正文用来验证编辑局部性".repeat(6);
    const { layout, ctx } = fixtureParams({
      systemContent: baseText,
      messages: [msg("user", baseText)],
    });
    const first = await countPromptLlmInput({
      layout,
      ctx,
      savedModelId: "openai/gpt-4o",
      registry,
    });
    assert.ok(first.tokenCount > 0);

    // 等长替换正文中部的一组非边界字符：确定性切分的前缀对齐不变，只有
    // 包含替换点的那一块 hash 变化。
    const editedText = baseText.replace("连续", "衔接");
    assert.notEqual(editedText, baseText, "夹具自检：替换必须真的发生");
    const ctxB = { ...ctx, messages: [msg("user", editedText)] };
    const serializedA =
      (await serializePromptLlmInput(layout, ctx)) +
      serializeToolsForTokenCount(undefined);
    const serializedB =
      (await serializePromptLlmInput(layout, ctxB)) +
      serializeToolsForTokenCount(undefined);
    const hashesA = splitTextIntoChunks(serializedA).map((c) => chunkHash16(c));
    const hashesB = splitTextIntoChunks(serializedB).map((c) => chunkHash16(c));
    assert.equal(hashesA.length, hashesB.length, "夹具自检：等长替换不改变块数");
    let changedChunks = 0;
    for (let i = 0; i < hashesA.length; i += 1) {
      if (hashesA[i] !== hashesB[i]) {
        changedChunks += 1;
      }
    }
    assert.equal(changedChunks, 1, "夹具自检：等长替换只应变化 1 块");

    const callsAfterFirst = recording.calls();
    const second = await countPromptLlmInput({
      layout,
      ctx: ctxB,
      savedModelId: "openai/gpt-4o",
      registry,
    });
    assert.ok(second.tokenCount > 0);
    // +1 = overhead 路径对 role "system" 的 encode（无边界恒 1 段；空串
    // content 在增量计数器里短路、不调 encode）。
    assert.equal(
      recording.calls() - callsAfterFirst,
      changedChunks + 1,
      "L1 miss 后 L2 前缀块应全命中，仅变化块现算",
    );
  });

  it("WEB 档（资产在）：L1 命中后第二次零文件读", async () => {
    // WEB 档每次计数都 new WebTokenizerCounter（实例不跨调用复用），无 L1
    // 时第二次必然重新读资产 JSON——这正是本用例的鉴别力来源。
    let readJsonCalls = 0;
    const realLoader = createNodeTokenizerLoader(defaultTokenizerAssetsRoot());
    setNodeTokenizerLoader({
      readJson(relativePath: string): ArrayBuffer {
        readJsonCalls += 1;
        return realLoader.readJson(relativePath);
      },
      readModel(relativePath: string): string {
        return realLoader.readModel(relativePath);
      },
    });

    try {
      const { layout, ctx } = fixtureParams();
      const params = {
        layout,
        ctx,
        savedModelId: "openai/claude-3-5-sonnet",
        registry,
      };
      const first = await countPromptLlmInput(params);
      assert.equal(first.counterKind, "claude");
      const readsAfterFirst = readJsonCalls;
      assert.ok(readsAfterFirst > 0, "夹具自检：首次 WEB 档计数必须真实加载过资产");

      const second = await countPromptLlmInput(params);
      assert.equal(second.tokenCount, first.tokenCount);
      assert.equal(second.counterKind, first.counterKind);
      assert.equal(
        readJsonCalls,
        readsAfterFirst,
        "L1 命中：同输入第二次不得再读资产文件",
      );
    } finally {
      registerTokenizerNodeDriverForTests();
    }
  });
});
