/**
 * T-T1 / T-T2 / T-T3 / T-T9：pickLastPromptUsage + resolveCurrentPromptTokens。
 *
 * T-T9 覆盖 API 占用的两种载体：进程内热层（Map）与 session KKV（跨重启）。
 * 后者是本轮治本点——「清掉进程 Map = 模拟重启」后仍能读到同一份 API 值。
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { registerNodeTokenizerDriverForTests } from "../../helpers/register-node-tokenizer-driver-for-tests.js";
import type { ChatMessage } from "../../../src/domain/chat/model/message.js";
import type { ModelRoundSummary } from "../../../src/domain/agent/model/agent-run-result.js";
import {
  clearTokenizerDrivers,
  registerTokenizerDriver,
} from "../../../src/infra/nmtp/index.js";
import {
  PROMPT_TOKENS_LAST_USAGE_KEY,
  SESSION_KKV_DOMAIN_PROMPT_TOKENS,
  SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
  TOKEN_CHUNKS_CACHE_KEY,
} from "../../../src/domain/session-kkv/model/session-kkv-domains.js";
import {
  createDefaultTokenCounterRegistry,
  pickLastPromptUsage,
  promptWholeCache,
  resolveCurrentPromptTokens,
  sessionApiPromptTokenCache,
  tokenChunkCache,
} from "../../../src/infra/tokenizer/index.js";
import { serializeSessionApiPromptTokenEntry } from "../../../src/infra/tokenizer/logic/session-api-prompt-token-store.js";
import { estimateTokensCjkAware } from "../../../src/infra/tokenizer/logic/estimate-tokens-cjk-aware.js";
import { formatChatMessageForCliPreview } from "../../../src/domain/chat/content/message-body-text.js";
import { createMemorySessionKkv } from "../../helpers/prompt-layout-test-helpers.js";
import { emptyRegistryDeps } from "./registry-test-helpers.js";

const SESSION_ID = "sess-token-resolve";
const RUN_MODEL_ID = "openai/gpt-4o";

function round(
  partial: Partial<ModelRoundSummary> & Pick<ModelRoundSummary, "step">,
): ModelRoundSummary {
  return {
    hadToolUse: false,
    finished: false,
    ...partial,
  };
}

function countParams() {
  return {
    layout: { persist: [], dynamic: [] },
    ctx: { workplaceDisplay: "", messages: [] },
    savedModelId: RUN_MODEL_ID,
    registry: createDefaultTokenCounterRegistry(emptyRegistryDeps()),
  };
}

describe("pickLastPromptUsage / resolveCurrentPromptTokens", () => {
  beforeEach(() => {
    registerNodeTokenizerDriverForTests();
    sessionApiPromptTokenCache.clearAll();
  });

  afterEach(() => {
    sessionApiPromptTokenCache.clearAll();
  });

  it("T-T1: 末轮无 prompt、中间轮有 → pick 中间最后有值者", () => {
    const rounds: ModelRoundSummary[] = [
      round({ step: 0, usage: { promptTokens: 100 } }),
      round({ step: 1, usage: { promptTokens: 250 } }),
      round({ step: 2, usage: { completionTokens: 10 } }),
    ];
    assert.equal(pickLastPromptUsage(rounds), 250);
  });

  it("T-T2: promptTokens: 0 视为可用", () => {
    const rounds: ModelRoundSummary[] = [
      round({ step: 0, usage: { promptTokens: 0 } }),
    ];
    assert.equal(pickLastPromptUsage(rounds), 0);
  });

  it("T-T3: usage 全缺 → resolve 走 local", async () => {
    const rounds: ModelRoundSummary[] = [
      round({ step: 0 }),
      round({ step: 1, usage: { completionTokens: 3 } }),
    ];
    assert.equal(pickLastPromptUsage(rounds), undefined);

    const resolved = await resolveCurrentPromptTokens(SESSION_ID, countParams());
    assert.equal(resolved.source, "local");
    assert.notEqual(resolved.counterKind, "api");
    assert.ok(resolved.tokenCount >= 0);
    assert.equal(resolved.atMs, undefined);
  });

  it("T-T9: 热层命中 ⇒ source===api && estimated===false && counterKind===api", async () => {
    sessionApiPromptTokenCache.set(SESSION_ID, {
      promptTokens: 1234,
      updatedAt: Date.now(),
    });
    const resolved = await resolveCurrentPromptTokens(SESSION_ID, countParams());
    assert.equal(resolved.source, "api");
    assert.equal(resolved.tokenCount, 1234);
    assert.equal(resolved.estimated, false);
    assert.equal(resolved.counterKind, "api");
  });

  it("T-T9(KKV): 热层 miss、KKV 命中 ⇒ api 并带上 atMs", async () => {
    const sessionKkv = createMemorySessionKkv();
    await sessionKkv.set(
      SESSION_ID,
      SESSION_KKV_DOMAIN_PROMPT_TOKENS,
      PROMPT_TOKENS_LAST_USAGE_KEY,
      serializeSessionApiPromptTokenEntry({
        promptTokens: 12_729,
        atMs: 1_700_000_000_000,
        savedModelId: RUN_MODEL_ID,
      }),
    );

    const resolved = await resolveCurrentPromptTokens(
      SESSION_ID,
      countParams(),
      { sessionKkv }
    );
    assert.equal(resolved.source, "api");
    assert.equal(resolved.tokenCount, 12_729);
    assert.equal(resolved.estimated, false);
    assert.equal(resolved.counterKind, "api");
    assert.equal(resolved.atMs, 1_700_000_000_000);
  });

  it("T-T9(跨重启): 清掉进程 Map 后仍从 KKV 读回同一 API 值（口径不跳）", async () => {
    const sessionKkv = createMemorySessionKkv();
    const params = countParams();

    // 命中同一模型前提下的「重启前」读数
    writeEntryFor(sessionKkv, RUN_MODEL_ID, 3_926);
    const before = await resolveCurrentPromptTokens(SESSION_ID, params, {
      sessionKkv,
    });
    assert.equal(before.source, "api");
    assert.equal(before.tokenCount, 3_926);

    // 模拟进程重启：进程内热层清空，DB（KKV）留存
    sessionApiPromptTokenCache.clearAll();
    const after = await resolveCurrentPromptTokens(SESSION_ID, params, {
      sessionKkv,
    });
    assert.equal(after.source, "api");
    assert.equal(after.tokenCount, 3_926, "重启后口径不得跌回本地估算");
    assert.equal(after.estimated, false);
    assert.equal(after.counterKind, "api");
  });

  it("T-T9(指纹): KKV 值的 savedModelId 与本次请求不符 ⇒ 当 miss 走 local", async () => {
    const sessionKkv = createMemorySessionKkv();
    await sessionKkv.set(
      SESSION_ID,
      SESSION_KKV_DOMAIN_PROMPT_TOKENS,
      PROMPT_TOKENS_LAST_USAGE_KEY,
      serializeSessionApiPromptTokenEntry({
        promptTokens: 99_999,
        atMs: 1,
        savedModelId: "anthropic/claude-old",
      })
    );
    const resolved = await resolveCurrentPromptTokens(
      SESSION_ID,
      countParams(),
      { sessionKkv }
    );
    assert.equal(resolved.source, "local");
    assert.notEqual(resolved.tokenCount, 99_999);
  });

  it("T-T6: invalidate 后回退 local（进程内层）", async () => {
    sessionApiPromptTokenCache.set(SESSION_ID, {
      promptTokens: 999,
      updatedAt: Date.now(),
    });
    sessionApiPromptTokenCache.invalidate(SESSION_ID);
    const resolved = await resolveCurrentPromptTokens(SESSION_ID, countParams());
    assert.equal(resolved.source, "local");
  });

  it("T-T6(KKV-badAtMs): KKV 行只有 promptTokens 无 atMs ⇒ 判 local（atMs 必填）", async () => {
    const sessionKkv = createMemorySessionKkv();
    // 直接落一行「缺 atMs」的坏值（绕过写 helper，模拟历史/损坏行）。
    await sessionKkv.set(
      SESSION_ID,
      SESSION_KKV_DOMAIN_PROMPT_TOKENS,
      PROMPT_TOKENS_LAST_USAGE_KEY,
      JSON.stringify({ promptTokens: 999 })
    );
    sessionApiPromptTokenCache.clearAll();

    const resolved = await resolveCurrentPromptTokens(
      SESSION_ID,
      countParams(),
      { sessionKkv }
    );
    assert.equal(
      resolved.source,
      "local",
      "atMs 缺失不得退化成 0 当合法值，必须整体按 miss 回退本地估算"
    );
  });

  it("T-T6(KKV): KKV 行被删后跨重启也不复活（读回 local）", async () => {
    const sessionKkv = createMemorySessionKkv();
    await sessionKkv.set(
      SESSION_ID,
      SESSION_KKV_DOMAIN_PROMPT_TOKENS,
      PROMPT_TOKENS_LAST_USAGE_KEY,
      serializeSessionApiPromptTokenEntry({ promptTokens: 999, atMs: 1 })
    );
    sessionApiPromptTokenCache.clearAll();

    await sessionKkv.delete(
      SESSION_ID,
      SESSION_KKV_DOMAIN_PROMPT_TOKENS,
      PROMPT_TOKENS_LAST_USAGE_KEY
    );

    const resolved = await resolveCurrentPromptTokens(
      SESSION_ID,
      countParams(),
      { sessionKkv }
    );
    assert.equal(resolved.source, "local");
  });
});

/** 直接落一条 KKV 值（不经过写 helper，避免测试耦合写入实现）。 */
async function writeEntryFor(
  sessionKkv: ReturnType<typeof createMemorySessionKkv>,
  savedModelId: string,
  promptTokens: number
): Promise<void> {
  await sessionKkv.set(
    SESSION_ID,
    SESSION_KKV_DOMAIN_PROMPT_TOKENS,
    PROMPT_TOKENS_LAST_USAGE_KEY,
    serializeSessionApiPromptTokenEntry({
      promptTokens,
      atMs: Date.now(),
      savedModelId,
    })
  );
}

/**
 * 统计优先（2026-09-29 用户拍板「像 metric 一样有哪个用哪个」；当晚真机
 * 复验二次修正）读口语义：
 * - API 命中 = 基线 + 采样锚点后追加消息的增量估算（纯追加不失效基线）；
 * - 本地 miss 回落模型自身家族计数器（glm→原生、gpt→tiktoken 分块），
 *   读口不改写调用方 override（强制 cl100k 估算档已撤回）。
 */
describe("resolveCurrentPromptTokens 统计优先（api 基线+增量，本地回落家族计数器）", () => {
  beforeEach(() => {
    registerNodeTokenizerDriverForTests();
    sessionApiPromptTokenCache.clearAll();
    promptWholeCache.clearForTests();
    tokenChunkCache.clearForTests();
  });

  function msg(
    seq: number,
    text: string,
    role = "user"
  ): ChatMessage {
    return {
      id: `m-${seq}`,
      sessionId: SESSION_ID,
      seq,
      role,
      content: { blocks: [{ type: "text", text }] },
      provider: null,
      raw: null,
      createdAtMs: 0,
      hidden: false,
    };
  }

  function paramsWithMessages(
    messages: ChatMessage[],
    savedModelId: string = RUN_MODEL_ID
  ) {
    return {
      layout: { persist: [], dynamic: [] },
      ctx: { workplaceDisplay: "", messages },
      savedModelId,
      registry: createDefaultTokenCounterRegistry(emptyRegistryDeps()),
    };
  }

  it("api 命中 + anchorSeq + 锚点后有追加消息 → 基线 + 增量（> 基线，不付计数）", async () => {
    const params = paramsWithMessages([msg(9, "九"), msg(10, "十号消息正文")]);
    sessionApiPromptTokenCache.set(SESSION_ID, {
      promptTokens: 50_000,
      updatedAt: Date.now(),
      savedModelId: RUN_MODEL_ID,
      anchorSeq: 9,
    });

    const resolved = await resolveCurrentPromptTokens(SESSION_ID, params);
    assert.equal(resolved.source, "api");
    assert.equal(resolved.counterKind, "api");
    assert.equal(resolved.estimated, false);
    assert.ok(
      resolved.tokenCount > 50_000,
      "锚点后追加了 seq=10 的消息，读值应是基线+增量"
    );
  });

  it("增量取 max(heuristic, CJK 感知) 的精确值：heuristic 压小后 CJK 下限必须生效（s1/G-1①）", async () => {
    // 可控 registry：heuristic 恒返 1，最大化区分「max 是否走了 CJK 下限」。
    // 旧断言只断 `> 基线`——把实现改回纯 heuristic（甚至删掉 max）仍绿；
    // 本用例把期望值钉到 estimateTokensCjkAware 对序列化 tail 的精确值。
    const tinyHeuristicRegistry = {
      heuristic: { countText: () => 1 },
    } as unknown as ReturnType<typeof createDefaultTokenCounterRegistry>;
    const baseline = 50_000;
    const params = {
      layout: { persist: [], dynamic: [] },
      ctx: { workplaceDisplay: "", messages: [msg(9, "九"), msg(10, "十号消息正文")] },
      savedModelId: RUN_MODEL_ID,
      registry: tinyHeuristicRegistry,
    };
    sessionApiPromptTokenCache.set(SESSION_ID, {
      promptTokens: baseline,
      updatedAt: Date.now(),
      savedModelId: RUN_MODEL_ID,
      anchorSeq: 9,
    });

    // 期望值：按读口的序列化口径复算 tail（seq > 9 且非 hidden）的 CJK 下限。
    const expectedTail = [msg(10, "十号消息正文")]
      .map((m) =>
        formatChatMessageForCliPreview(m)
          .map((segment) => `${segment.role}: ${segment.body}`)
          .join("\n\n")
      )
      .join("\n\n");
    const expectedDelta = estimateTokensCjkAware(expectedTail);
    assert.ok(expectedDelta > 1, "中文 tail 的 CJK 下限应远大于 heuristic 的 1");

    const resolved = await resolveCurrentPromptTokens(SESSION_ID, params);
    assert.equal(resolved.tokenCount, baseline + expectedDelta);
  });

  it("api 命中 + 锚点后无追加（或无锚点）→ 基线原样", async () => {
    // 锚点 ≥ 当前最大 seq：无增量
    sessionApiPromptTokenCache.set(SESSION_ID, {
      promptTokens: 50_000,
      updatedAt: Date.now(),
      savedModelId: RUN_MODEL_ID,
      anchorSeq: 10,
    });
    const noDelta = await resolveCurrentPromptTokens(
      SESSION_ID,
      paramsWithMessages([msg(9, "九"), msg(10, "十")])
    );
    assert.equal(noDelta.tokenCount, 50_000);

    // 无锚点（老行）：delta 按 0
    sessionApiPromptTokenCache.set(SESSION_ID, {
      promptTokens: 60_000,
      updatedAt: Date.now(),
      savedModelId: RUN_MODEL_ID,
    });
    const noAnchor = await resolveCurrentPromptTokens(
      SESSION_ID,
      paramsWithMessages([msg(9, "九")])
    );
    assert.equal(noAnchor.tokenCount, 60_000);
  });

  it("api 命中 + anchorSeq 严格大于现存最大 seq（回滚删尾后悬空）→ 基线原样", async () => {
    // cr-test-1①：回滚把尾部物理删除后，锚点可能悬空指向「已不存在的高
    // seq」——过滤结果为空、delta=0、基线原样（下一次 usage 回锚自愈）。
    // 现有「锚点后无追加」用例只覆盖锚点 == 最大 seq，这里钉严格大于形态。
    sessionApiPromptTokenCache.set(SESSION_ID, {
      promptTokens: 50_000,
      updatedAt: Date.now(),
      savedModelId: RUN_MODEL_ID,
      anchorSeq: 99,
    });
    const resolved = await resolveCurrentPromptTokens(
      SESSION_ID,
      paramsWithMessages([msg(9, "九"), msg(10, "十")])
    );
    assert.equal(resolved.source, "api");
    assert.equal(resolved.estimated, false);
    assert.equal(
      resolved.tokenCount,
      50_000,
      "悬空锚点不得产生负增量或误判 miss，基线原样使用"
    );
  });

  it("本地 miss → 透传模型家族计数器（glm 不再强制估算档，真机复验拍板）", async () => {
    const captured: { override?: unknown } = {};
    clearTokenizerDrivers();
    registerTokenizerDriver({
      name: "mock-stats-first",
      countPromptLlmInput: async (params) => {
        captured.override = params.tokenizerOverride;
        return {
          tokenCount: 1_234,
          counterKind: "glm",
          estimated: false,
          savedModelId: params.savedModelId,
          vendorModelId: "zai/glm-4.6",
          tokenizerFamily: "glm",
        };
      },
    });

    const resolved = await resolveCurrentPromptTokens(
      SESSION_ID,
      paramsWithMessages([], "zai/glm-4.6")
    );
    assert.equal(resolved.source, "local");
    assert.equal(
      captured.override,
      undefined,
      "读口不得改写调用方 override——WEB 家族回落自身家族计数器（强制 cl100k 估算档已撤回）"
    );
    assert.equal(resolved.counterKind, "glm");
    assert.equal(resolved.estimated, false, "驱动结果原样透传");
  });

  it("本地 miss + 调用方显式 override → 原样透传（heuristic 不被改写）", async () => {
    const captured: { override?: unknown } = {};
    clearTokenizerDrivers();
    registerTokenizerDriver({
      name: "mock-stats-first-2",
      countPromptLlmInput: async (params) => {
        captured.override = params.tokenizerOverride;
        return {
          tokenCount: 10,
          counterKind: "tiktoken",
          estimated: false,
          savedModelId: params.savedModelId,
          vendorModelId: "openai/gpt-4o",
          tokenizerFamily: "tiktoken",
        };
      },
    });

    // 未传 override：undefined 原样透传
    await resolveCurrentPromptTokens(
      SESSION_ID,
      paramsWithMessages([], RUN_MODEL_ID)
    );
    assert.equal(captured.override, undefined);

    // 调用方显式 heuristic：透传不改写
    await resolveCurrentPromptTokens(SESSION_ID, {
      ...paramsWithMessages([], RUN_MODEL_ID),
      tokenizerOverride: "heuristic",
    });
    assert.equal(captured.override, "heuristic");
  });

  it("preferEstimate：不调驱动、CJK 下限生效、api 命中不受影响", async () => {
    const captured: { driverCalled: number } = { driverCalled: 0 };
    clearTokenizerDrivers();
    registerTokenizerDriver({
      name: "mock-prefer-estimate",
      countPromptLlmInput: async () => {
        captured.driverCalled += 1;
        return {
          tokenCount: 1,
          counterKind: "tiktoken",
          estimated: false,
          savedModelId: "openai/gpt-4o",
          vendorModelId: "openai/gpt-4o",
          tokenizerFamily: "tiktoken",
        };
      },
    });

    // 本地 miss + preferEstimate：heuristic 即回（CJK 感知下限），驱动零调用
    const cjkParams = {
      layout: { persist: [], dynamic: [], system: "夜色如水林间小径" },
      ctx: { workplaceDisplay: "", messages: [] },
      savedModelId: RUN_MODEL_ID,
      registry: createDefaultTokenCounterRegistry(emptyRegistryDeps()),
    };
    const estimated = await resolveCurrentPromptTokens(
      SESSION_ID,
      cjkParams,
      { preferEstimate: true }
    );
    assert.equal(captured.driverCalled, 0, "估算优先不得调驱动");
    assert.equal(estimated.source, "local");
    assert.equal(estimated.counterKind, "heuristic");
    assert.equal(estimated.estimated, true);
    // 「夜色如水林间小径」8 个 CJK 字符 → 下限 ceil(8×1.64)=14 > /3.35 的 3
    assert.ok(estimated.tokenCount >= 14, "CJK 下限必须压过英文口径的低估");

    // api 命中 + preferEstimate：仍走 api 精确分支（不受影响）
    sessionApiPromptTokenCache.set(SESSION_ID, {
      promptTokens: 9_999,
      updatedAt: Date.now(),
      savedModelId: RUN_MODEL_ID,
    });
    const apiHit = await resolveCurrentPromptTokens(
      SESSION_ID,
      { ...cjkParams, layout: { persist: [], dynamic: [] } },
      { preferEstimate: true }
    );
    assert.equal(apiHit.source, "api");
    assert.equal(apiHit.tokenCount, 9_999);
    assert.equal(captured.driverCalled, 0);
  });

  it("preferEstimate 先查 L1：完整口径暖出的整串条目被首帧直读（cr-fix-spec-r2 s2/G-1）", async () => {
    promptWholeCache.clearForTests();
    const params = {
      layout: { persist: [], dynamic: [], system: "暖机后首帧直读的精确占位" },
      ctx: { workplaceDisplay: "", messages: [] },
      savedModelId: RUN_MODEL_ID,
      registry: createDefaultTokenCounterRegistry(emptyRegistryDeps()),
    };

    // 冷 L1 首帧：估算档（gpt ≈ 语义）。
    const cold = await resolveCurrentPromptTokens(SESSION_ID, params, {
      preferEstimate: true,
    });
    assert.equal(cold.estimated, true);
    assert.equal(cold.counterKind, "heuristic");

    // 暖机：完整口径计数一次（真 node 驱动 → tiktoken 精确档 + L1 写入）。
    const warm = await resolveCurrentPromptTokens(SESSION_ID, params);
    assert.equal(warm.estimated, false);
    assert.equal(warm.counterKind, "tiktoken");

    // 暖后首帧：L1 命中 → 精确档直读、数值与暖机一致。旧实现（早退不查
    // L1）这里仍是 heuristic/estimated:true——本断言即回归锁。
    const warmFirst = await resolveCurrentPromptTokens(SESSION_ID, params, {
      preferEstimate: true,
    });
    assert.equal(warmFirst.source, "local");
    assert.equal(
      warmFirst.estimated,
      false,
      "L1 命中应直读精确档而非估算（暖机写的 L1 必须有人消费）"
    );
    assert.equal(warmFirst.counterKind, "tiktoken");
    assert.equal(warmFirst.tokenCount, warm.tokenCount);
  });
});

/**
 * T-TC5 读口侧（message-token-cache Step 3 分层挂接）：驱动层只做内存层，
 * 代际推进 + KKV 持久化挂本读口的本地计数分支——seedFromKkv（计数前）与
 * advanceGeneration（计数后，realRefresh 持久化）。
 */
describe("message-token-cache 读口挂接（T-TC5 读口侧）", () => {
  beforeEach(() => {
    registerNodeTokenizerDriverForTests();
    sessionApiPromptTokenCache.clearAll();
    promptWholeCache.clearForTests();
    tokenChunkCache.clearForTests();
  });

  /** 带正文的参数（空 layout 序列化为空串、产不出可断言的块）。 */
  function countParamsWithText(text: string) {
    return {
      layout: { persist: [], dynamic: [], system: text },
      ctx: { workplaceDisplay: "", messages: [] },
      savedModelId: RUN_MODEL_ID,
      registry: createDefaultTokenCounterRegistry(emptyRegistryDeps()),
    };
  }

  it("本地计数后推进代际并写 token_chunks KKV；清 L2 热层后种子载入、同内容零 miss", async () => {
    const sessionKkv = createMemorySessionKkv();
    const params = countParamsWithText(
      "夜色如水，林间小径上落满了枯叶。她停下脚步，抬头望向灯火。",
    );

    const first = await resolveCurrentPromptTokens(SESSION_ID, params, {
      sessionKkv,
    });
    assert.equal(first.source, "local");

    // advanceGeneration(realRefresh)：本地计数收尾把当前代整表写进了 KKV。
    const raw = await sessionKkv.get(
      SESSION_ID,
      SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
      TOKEN_CHUNKS_CACHE_KEY
    );
    assert.notEqual(raw, null, "本地计数后应写入 token_chunks/chunkCache 行");

    // 模拟进程重启：L1/L2 热层全清，KKV 留存——同内容再计数应靠种子全命中。
    promptWholeCache.clearForTests();
    tokenChunkCache.clearForTests();
    const second = await resolveCurrentPromptTokens(SESSION_ID, params, {
      sessionKkv,
    });
    assert.equal(second.source, "local");
    assert.equal(second.tokenCount, first.tokenCount);
    assert.equal(
      tokenChunkCache.stats().misses,
      0,
      "种子载入后同内容计数不得再有 L2 miss（块计数全部来自 KKV 种子）"
    );
  });

  it("无 sessionKkv（CLI / 测试）：本地计数只推内存代、不持久化", async () => {
    const params = countParamsWithText("他把伞收了，窗外的雨顺着玻璃往下淌。");
    const resolved = await resolveCurrentPromptTokens(SESSION_ID, params);
    assert.equal(resolved.source, "local");
    // 驱动把块写进当前代，读口 advanceGeneration 推代后条目落第二代
    // （当前代清空待下轮计数复用）。
    const { genCounts } = tokenChunkCache.stats();
    assert.ok(
      genCounts[1] > 0,
      `本地计数收尾应推进代际（块条目应在第二代，实际 ${JSON.stringify(genCounts)}）`
    );
  });
});
