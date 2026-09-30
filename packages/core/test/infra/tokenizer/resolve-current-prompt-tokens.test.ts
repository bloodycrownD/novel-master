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
  PROMPT_WHOLE_CACHE_KEY,
  SESSION_KKV_DOMAIN_PROMPT_TOKENS,
  SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
  TOKEN_CHUNKS_CACHE_KEY,
} from "../../../src/domain/session-kkv/model/session-kkv-domains.js";
import {
  createDefaultTokenCounterRegistry,
  pickLastPromptUsage,
  PromptTokenResolveBailedError,
  promptWholeCache,
  resolveCurrentPromptTokens,
  sessionApiPromptTokenCache,
  tokenChunkCache,
} from "../../../src/infra/tokenizer/index.js";
import type { PromptRenderContext } from "../../../src/domain/prompt/model/prompt-render-context.js";
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

  /**
   * 数 `token_chunks/chunkCache` 这一整表行的实际 get / set 次数。同一域里
   * L1 的 `promptWholeCache` 键不计入（量小、且不在本次护栏范围内），API
   * 值那条更在别的域。
   */
  function instrumentChunkRowKkv(): {
    kkv: ReturnType<typeof createMemorySessionKkv>;
    gets: () => number;
    sets: () => number;
  } {
    const base = createMemorySessionKkv();
    let gets = 0;
    let sets = 0;
    const isChunkRow = (domain: string, key: string): boolean =>
      domain === SESSION_KKV_DOMAIN_TOKEN_CHUNKS && key === TOKEN_CHUNKS_CACHE_KEY;
    const kkv = {
      ...base,
      async get(sessionId: string, domain: string, key: string) {
        if (isChunkRow(domain, key)) gets += 1;
        return base.get(sessionId, domain, key);
      },
      async set(
        sessionId: string,
        domain: string,
        key: string,
        value: string
      ): Promise<void> {
        if (isChunkRow(domain, key)) sets += 1;
        await base.set(sessionId, domain, key, value);
      },
    };
    return { kkv, gets: () => gets, sets: () => sets };
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

  /**
   * 2026-09-30 真机 12.5s 病根的读口级护栏：会话只剩 1 条可见消息时，本地
   * 计数本身是零成本的，但读口每轮都重走一遍 L2 整表 KKV 链（计数前
   * seedFromKkv 整表读 + parse + 全量 Map 重建；计数后 advanceGeneration
   * 整表序列化 + 覆盖写）。历史消息多的会话这条链是 MB 级，每轮都走一遍
   * 就是秒级卡顿。
   *
   * 口径：数 `token_chunks/chunkCache` 这一行的实际 get / set 次数（其余域
   * 键不计——API 值读写与 L1 落盘走别的键）。
   */
  it("连刷两轮本地计数：第二轮不再 seed（seed-once，整表读只发一次）", async () => {
    const probe = instrumentChunkRowKkv();
    const params = countParamsWithText(
      "夜色如水，林间小径上落满了枯叶。她停下脚步，抬头望向灯火。",
    );

    const first = await resolveCurrentPromptTokens(SESSION_ID, params, {
      sessionKkv: probe.kkv,
    });
    assert.equal(first.source, "local");
    assert.equal(probe.gets(), 1, "首轮：计数前 seed 一次整表读");
    assert.equal(probe.sets(), 1, "首轮：有新块计数 → 整表落盘一次");

    // 第二轮同会话同内容：读口不该再把整表 KKV 行读回来 parse 一遍。
    const second = await resolveCurrentPromptTokens(SESSION_ID, params, {
      sessionKkv: probe.kkv,
    });
    assert.equal(second.tokenCount, first.tokenCount, "同内容读数必须一致");
    assert.equal(probe.gets(), 1, "第二轮不得再 seed（seed-once）");
  });

  it("重启后按种子全命中的一轮：不重复整表落盘（脏标记）", async () => {
    const probe = instrumentChunkRowKkv();
    const params = countParamsWithText(
      "夜色如水，林间小径上落满了枯叶。她停下脚步，抬头望向灯火。",
    );

    const first = await resolveCurrentPromptTokens(SESSION_ID, params, {
      sessionKkv: probe.kkv,
    });
    assert.equal(first.source, "local");
    assert.equal(probe.sets(), 1, "首轮：有新块计数 → 整表落盘一次");

    // 只留 L2 整表种子：删掉 L1 整串行（L1 命中会在驱动入口短路、压根不进
    // L2——那不是本用例要验的路径），再清热层模拟进程重启。
    await probe.kkv.delete(
      SESSION_ID,
      SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
      PROMPT_WHOLE_CACHE_KEY
    );
    promptWholeCache.clearForTests();
    tokenChunkCache.clearForTests();

    const second = await resolveCurrentPromptTokens(SESSION_ID, params, {
      sessionKkv: probe.kkv,
    });
    assert.equal(second.tokenCount, first.tokenCount);
    assert.ok(
      tokenChunkCache.stats().hits > 0 && tokenChunkCache.stats().misses === 0,
      "夹具前提：这轮全部块来自 L2 种子（只有命中提升、零 record）"
    );
    assert.equal(probe.gets(), 2, "重启算新进程：这一次 seed 必须真读");
    assert.equal(
      probe.sets(),
      1,
      "零新记录的轮次不得重复整表序列化与写（脏标记跳过）"
    );
  });

  it("重启后内容变了（有新块）→ 照常整表落库（脏标记复位）", async () => {
    const probe = instrumentChunkRowKkv();
    await resolveCurrentPromptTokens(
      SESSION_ID,
      countParamsWithText("第一段正文内容。"),
      { sessionKkv: probe.kkv }
    );
    assert.equal(probe.sets(), 1);

    promptWholeCache.clearForTests();
    tokenChunkCache.clearForTests();

    const second = await resolveCurrentPromptTokens(
      SESSION_ID,
      countParamsWithText("第二段完全不同的正文内容。"),
      { sessionKkv: probe.kkv }
    );
    assert.equal(second.source, "local");
    assert.ok(
      tokenChunkCache.stats().misses > 0,
      "夹具前提：内容变了 → 有新块需要现算"
    );
    assert.equal(probe.sets(), 2, "有新块的轮次必须重新落库");
  });
});

/**
 * r3-chip-1 弃权观察点（resolve 段 shouldBail）：「进得去停不下」的治本点。
 * build 段有分段 bail，但 resolve 链的整串级重活（序列化 / 原生家族计数器整串
 * 计数，glm ~5.8s）此前零观察点——run 起步后读口无从兑现弃权。
 *
 * 两处检查点都必须是「重活**之前**」：插在之后就等于没有弃权点。
 */
describe("r3-chip-1 resolve 段 shouldBail 弃权观察点", () => {
  beforeEach(() => {
    registerNodeTokenizerDriverForTests();
    sessionApiPromptTokenCache.clearAll();
    promptWholeCache.clearForTests();
    tokenChunkCache.clearForTests();
  });

  afterEach(() => {
    sessionApiPromptTokenCache.clearAll();
    clearTokenizerDrivers();
  });

  it("插入点①：preferEstimate 段在序列化之前 bail（整串重活根本没起跑）", async () => {
    // ctx.messages 的 getter 即探针：序列化链（formatPromptLlmInputForCliFromLayout）
    // 必然读它，「摸都没摸过」= 检查点在整串序列化之前。
    let messageTouches = 0;
    const ctx = {
      workplaceDisplay: "",
      get messages(): ChatMessage[] {
        messageTouches += 1;
        return [];
      },
    } as unknown as PromptRenderContext;
    const params = {
      layout: { persist: [], dynamic: [], system: "弃权点必须在整串序列化之前" },
      ctx,
      savedModelId: RUN_MODEL_ID,
      registry: createDefaultTokenCounterRegistry(emptyRegistryDeps()),
    };

    await assert.rejects(
      resolveCurrentPromptTokens(SESSION_ID, params, {
        preferEstimate: true,
        shouldBail: () => true,
      }),
      (error: unknown) => {
        assert.ok(
          error instanceof PromptTokenResolveBailedError,
          "命中 must throw PromptTokenResolveBailedError（读口按它收成空串哨兵）"
        );
        return true;
      }
    );
    assert.equal(
      messageTouches,
      0,
      "检查点①必须在序列化之前——摸到 ctx.messages 就说明整串重活已经开跑"
    );
  });

  it("插入点②：L1/L2 seed 之后、countPromptLlmInput 之前 bail（原生计数零调用）", async () => {
    // 用计数驱动替代真 node 驱动，把「驱动被调了几次」钉成可断言量——
    // 整串原生计数是 resolve 链最重的一步，弃权必须在它起跑前生效。
    let driverCalled = 0;
    clearTokenizerDrivers();
    registerTokenizerDriver({
      name: "mock-resolve-bail",
      countPromptLlmInput: async () => {
        driverCalled += 1;
        return {
          tokenCount: 1,
          counterKind: "tiktoken",
          estimated: false,
          savedModelId: RUN_MODEL_ID,
          vendorModelId: RUN_MODEL_ID,
          tokenizerFamily: "tiktoken",
        };
      },
    });
    // 探 L2 那一整表行的 KKV 读次数：seed 发生过 = 检查点在 seed 之后。
    const base = createMemorySessionKkv();
    let chunkRowGets = 0;
    const sessionKkv = {
      ...base,
      async get(sessionId: string, domain: string, key: string) {
        if (
          domain === SESSION_KKV_DOMAIN_TOKEN_CHUNKS &&
          key === TOKEN_CHUNKS_CACHE_KEY
        ) {
          chunkRowGets += 1;
        }
        return base.get(sessionId, domain, key);
      },
    };
    const params = {
      layout: { persist: [], dynamic: [], system: "夜色如水林间小径" },
      ctx: { workplaceDisplay: "", messages: [] } as unknown as PromptRenderContext,
      savedModelId: RUN_MODEL_ID,
      registry: createDefaultTokenCounterRegistry(emptyRegistryDeps()),
    };

    await assert.rejects(
      resolveCurrentPromptTokens(SESSION_ID, params, {
        sessionKkv,
        shouldBail: () => true,
      }),
      (error: unknown) => {
        assert.ok(error instanceof PromptTokenResolveBailedError);
        return true;
      }
    );
    assert.equal(driverCalled, 0, "弃权后原生整串计数零调用（进得去停不下已治本）");
    assert.equal(chunkRowGets, 1, "检查点②在 L1/L2 seed 之后：seed 的读已发生");
  });

  it("不传 shouldBail：行为与加弃权观察点前逐字段一致（token-ratio.trigger 用法零影响）", async () => {
    // token-ratio.trigger.ts:58 是唯一不传 shouldBail 的调用方：压缩评估
    // **绝不**为本地计数阻塞 run，但也**绝不**接受半路抛错——恒不弃权即行为不变。
    const params = {
      layout: { persist: [], dynamic: [], system: "夜色如水林间小径" },
      ctx: { workplaceDisplay: "", messages: [] } as unknown as PromptRenderContext,
      savedModelId: RUN_MODEL_ID,
      registry: createDefaultTokenCounterRegistry(emptyRegistryDeps()),
    };
    const resolved = await resolveCurrentPromptTokens(SESSION_ID, params);
    assert.equal(resolved.source, "local");
    assert.equal(resolved.estimated, false, "完整口径仍是家族精确档");
    assert.ok(resolved.tokenCount > 0);
  });
});

/**
 * 2026-09-30 r3-cache-2 读口级护栏：L1 整串 KKV 行（`token_chunks/promptWholeCache`）
 * 此前**每轮本地计数都重读一遍**（JSON.parse + 全量回放 L1），与 L2 整表行
 * 同源同病（真机 12.5s）。两条读口路径都会命中它：`preferEstimate` 分支的
 * L1 预查（`lookupWholeCacheEntry` 内的 seed）与完整口径分支的 seed 段。
 *
 * 计数口径**按 key 过滤**：`promptWholeCache` 与 `chunkCache` 同域不同键，
 * 必须分开数——共用一个计数器会把 L2 的读吞进 L1 头里（去实现时看不出节流
 * 失效，因为 L2 自己的节流仍然在生效）。
 */
describe("L1 整串行 seed-once（r3-cache-2 读口级）", () => {
  beforeEach(() => {
    registerNodeTokenizerDriverForTests();
    sessionApiPromptTokenCache.clearAll();
    promptWholeCache.clearForTests();
    tokenChunkCache.clearForTests();
  });

  function countParamsWithText(text: string) {
    return {
      layout: { persist: [], dynamic: [], system: text },
      ctx: { workplaceDisplay: "", messages: [] },
      savedModelId: RUN_MODEL_ID,
      registry: createDefaultTokenCounterRegistry(emptyRegistryDeps()),
    };
  }

  /** 分别数 L1 整串行 / L2 整表行（`token_chunks` 域内的两个不同键）的 get 次数。 */
  function instrumentTokenChunksRows(options?: { failFirstWholeGet?: boolean }): {
    kkv: ReturnType<typeof createMemorySessionKkv>;
    wholeGets: () => number;
    chunkGets: () => number;
  } {
    const base = createMemorySessionKkv();
    let wholeGets = 0;
    let chunkGets = 0;
    let firstWholeGet = true;
    const kkv = {
      ...base,
      async get(sessionId: string, domain: string, key: string) {
        if (domain === SESSION_KKV_DOMAIN_TOKEN_CHUNKS) {
          if (key === PROMPT_WHOLE_CACHE_KEY) {
            wholeGets += 1;
            if (firstWholeGet) {
              firstWholeGet = false;
              if (options?.failFirstWholeGet === true) {
                throw new Error("db busy");
              }
            }
          } else if (key === TOKEN_CHUNKS_CACHE_KEY) {
            chunkGets += 1;
          }
        }
        return base.get(sessionId, domain, key);
      },
    };
    return { kkv, wholeGets: () => wholeGets, chunkGets: () => chunkGets };
  }

  const TEXT = "夜色如水，林间小径上落满了枯叶。她停下脚步，抬头望向灯火。";

  it("连刷两轮完整口径：L1 整串行只读一次（gets===1，与 L2 行分别计数）", async () => {
    const probe = instrumentTokenChunksRows();
    const params = countParamsWithText(TEXT);

    const first = await resolveCurrentPromptTokens(SESSION_ID, params, {
      sessionKkv: probe.kkv,
    });
    assert.equal(first.source, "local");
    assert.equal(probe.wholeGets(), 1, "首轮：计数前 L1 seed 一次");
    assert.equal(probe.chunkGets(), 1, "夹具前提：L2 行独立读了一次（同域不同键）");

    // 第二轮同会话：L1 seed 已被节流挡掉（该行本进程内只会被覆盖写成更新的
    // 内容，重复读只是把热层数据再 parse 一遍）。
    const second = await resolveCurrentPromptTokens(SESSION_ID, params, {
      sessionKkv: probe.kkv,
    });
    assert.equal(second.tokenCount, first.tokenCount, "同内容读数必须一致");
    assert.equal(probe.wholeGets(), 1, "第二轮不得再读 L1 整串行（r3-cache-2）");
    assert.equal(probe.chunkGets(), 1, "L2 行同样只读一次（各自节流）");
  });

  it("preferEstimate 的 L1 预查路径同样命中节流（内容变了也不重读）", async () => {
    const probe = instrumentTokenChunksRows();
    const params = countParamsWithText(TEXT);
    await resolveCurrentPromptTokens(SESSION_ID, params, { sessionKkv: probe.kkv });
    assert.equal(probe.wholeGets(), 1, "夹具前提：首轮已读过一次");

    // 换一份内容 → L1 键（内容指纹）变了，预查必然 miss → 走
    // lookupWholeCacheEntry 里的 seed。这条路径与完整口径那条共用同一份
    // 登记，第二条也必须被节流挡掉（注意不能用 clearForTests 来造 miss：
    // 它连节流登记一起复位，那是「进程重启」语义、不是「热层被清」）。
    const otherParams = countParamsWithText(`${TEXT}这是另一段完全不同的正文。`);
    const estimated = await resolveCurrentPromptTokens(SESSION_ID, otherParams, {
      sessionKkv: probe.kkv,
      preferEstimate: true,
    });
    assert.equal(
      estimated.counterKind,
      "heuristic",
      "夹具前提：内容指纹已变且本进程不重读 → 预查无命中，按估算档回"
    );
    assert.equal(probe.wholeGets(), 1, "预查路径也必须命中 seed-once（r3-cache-2）");
  });

  it("L1 读失败不跳口径、也不永久失种：第二轮重读并把上轮落盘行载入", async () => {
    const probe = instrumentTokenChunksRows({ failFirstWholeGet: true });
    const params = countParamsWithText(TEXT);
    const originalWarn = console.warn;
    console.warn = (): void => undefined;

    try {
      const first = await resolveCurrentPromptTokens(SESSION_ID, params, {
        sessionKkv: probe.kkv,
      });
      assert.equal(first.source, "local", "读失败不打断计数路径（静默按无种子处理）");
      assert.equal(probe.wholeGets(), 1);
      assert.ok(first.tokenCount > 0);

      // 首轮 L1 记的精确档条目已经由 persistPendingWrites 落库；登记被撤销，
      // 第二轮 seed 会真读一次并把它载入（不撤销登记就永远读不到它）。
      const second = await resolveCurrentPromptTokens(SESSION_ID, params, {
        sessionKkv: probe.kkv,
      });
      assert.equal(second.tokenCount, first.tokenCount, "口径不跳");
      assert.equal(
        probe.wholeGets(),
        2,
        "L1 读失败必须撤销登记、下轮重试（r3-cache-2，别把 r3-l2-1 的 bug 复刻到 L1）"
      );
      assert.ok(
        promptWholeCache.stats().entries > 0,
        "第二轮 seed 应把库里那行回放进 L1"
      );
    } finally {
      console.warn = originalWarn;
    }
  });
});
