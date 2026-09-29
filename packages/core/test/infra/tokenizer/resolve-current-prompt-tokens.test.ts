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
