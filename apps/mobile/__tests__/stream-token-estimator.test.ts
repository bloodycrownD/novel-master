/**
 * mobile 实时 token 估算器（js-tiktoken 尾窗增量）精度 / 性能用例
 * （stream-metrics-native ②）。
 *
 * 基准是同一段文本的**全量 encode 真值**（cl100k_base），流式口径按 7 字符
 * 一个 delta 逐段 push——正好模拟 mobile 的 TEXT_DELTA 事件节奏。误差目标：
 * 英文 ≤3%、中文 ≤1%（尾窗 + 自然边界固化下应远低于该上界）；性能护栏是
 * **数量级回归线**（中位/均摊 ≤5ms、峰值 ≤50ms，见下方常量注释）：纯中文无
 * 空白串的全量 encode 在真实 tiktoken 下是 88s/12000 字量级，这条护栏就是防
 * 它回来的；精确的「单次 encode 字符数有界」不变量由 core 侧假 encode 用例断言。
 *
 * 同时验证 ranks 命名空间在 jest（CJS require 形态）下可加载：`import *` 得到
 * 命名导出（无 default），与 Metro/ESM 的 default 形态由同一份
 * `(mod.default ?? mod)` 兼容取值覆盖。
 *
 * @module test/stream-token-estimator
 */
import {describe, expect, it, jest, afterEach} from '@jest/globals';
import {Tiktoken} from 'js-tiktoken/lite';
import * as cl100kRanksModule from 'js-tiktoken/ranks/cl100k_base';
import * as o200kRanksModule from 'js-tiktoken/ranks/o200k_base';
import {
  createSessionStreamTokenEstimator,
  createStreamTokenEstimator,
  primeStreamTokenModelHint,
  resolveStreamTokenEncodingName,
  type StreamTokenModelHintRuntime,
} from '@/services/stream-token-estimator';

/** 中文长文（含标点与换行，3540 字符）。 */
const ZH_PASSAGE =
  '夜色如水，林间小径上落满了枯叶，风一吹便沙沙作响。她停下脚步，抬头望向远处那片朦胧的灯火，心里忽然涌起一阵说不清的情绪。\n'.repeat(
    60,
  );
/** 英文长文（3675 字符）。 */
const EN_PASSAGE =
  'The night was quiet and the forest path was covered with fallen leaves, rustling whenever the wind blew. '.repeat(
    35,
  );

/** 取 ranks 模块（jest 下 CJS 命名导出、ESM 下 default，两种形态都兼容）。 */
function ranksOf(mod: unknown): unknown {
  return (mod as {default?: unknown}).default ?? mod;
}

function encodeFull(ranks: unknown, text: string): number {
  const encoding = new Tiktoken(ranks as never);
  return encoding.encode(text).length;
}

/** 逐 delta 流过估算器，返回末值与耗时统计。 */
function streamThrough(text: string, chunkChars = 7): {
  readonly tokens: number;
  readonly maxPushMs: number;
  readonly warmP99PushMs: number;
  readonly medianPushMs: number;
  readonly avgPushMs: number;
  readonly totalMs: number;
} {
  const counter = createStreamTokenEstimator({vendorModelId: null});
  expect(counter).not.toBeNull();
  const estimator = counter!;
  const pushDurations: number[] = [];
  const startedAt = performance.now();
  for (let i = 0; i < text.length; i += chunkChars) {
    const chunk = text.slice(i, i + chunkChars);
    const pushStartedAt = performance.now();
    estimator.push(chunk);
    void estimator.tokens;
    pushDurations.push(performance.now() - pushStartedAt);
  }
  // 首 ~30 次 push 含 JIT 预热与模块惰性编译的尖峰，不计入稳态统计
  // （冷启动峰值仍如实打日志，便于对照）；jest 并行 worker 下 GC 与调度停顿
  // 可达数毫秒，**极小值统计量（p99/max）不适合当护栏**——护栏取均摊 + 中位
  // 双口径，另加一条宽松的「未退化成全量重算」上界（见下方 assertMaxPushMs）；
  // 纯 Node 对照见 spec 第 5 节的实测表（峰值 0.92ms）。
  const warmupPushes = 30;
  const warm = pushDurations.slice(warmupPushes).sort((a, b) => a - b);
  const p99Index = Math.min(warm.length - 1, Math.floor(warm.length * 0.99));
  const warmP99PushMs = warm[p99Index] ?? 0;
  const medianPushMs = warm[Math.floor(warm.length / 2)] ?? 0;
  const avgPushMs =
    pushDurations.reduce((sum, ms) => sum + ms, 0) / pushDurations.length;
  return {
    tokens: estimator.tokens,
    maxPushMs: pushDurations.reduce((max, ms) => (ms > max ? ms : max), 0),
    warmP99PushMs,
    medianPushMs,
    avgPushMs,
    totalMs: performance.now() - startedAt,
  };
}

/**
 * 性能护栏（毫秒）：本用例是**数量级回归线**，不是精度基准——jest 并行 worker
 * 下 GC 与调度停顿随负载浮动（空闲机均摊 0.47ms／中位 0.5ms，全量并行时实测
 * 1.03ms），把线卡在 1ms 会拿环境噪声当回归。真正的退化形态是「每次 push 全量
 * 重算」：12,000 字量级 60–100ms/次、纯中文无空白串 88s 量级——因此取
 * 中位/均摊 ≤5ms、峰值 ≤50ms，两个数量级余量，退化必炸、噪声必过。
 * 精确的 O(1) 不变量（单次 encode 字符数有界）由 core 的
 * `incremental-token-counter.test.ts` 用计数假 encode 断言。
 */
const ASSERT_MEDIAN_PUSH_MS = 5;
const ASSERT_AVG_PUSH_MS = 5;
const ASSERT_MAX_PUSH_MS = 50;

describe('实时 token 估算器（js-tiktoken 尾窗增量）', () => {
  it('中文长文（≥3,000 字符）：相对全量 encode 误差 ≤1%', () => {
    expect(ZH_PASSAGE.length).toBeGreaterThanOrEqual(3_000);
    const truth = encodeFull(ranksOf(cl100kRanksModule), ZH_PASSAGE);
    const result = streamThrough(ZH_PASSAGE);
    const errorRate = Math.abs(result.tokens - truth) / truth;
    console.log(
      `[②中文] 真值 ${truth} t，估算 ${result.tokens} t，误差 ${(
        errorRate * 100
      ).toFixed(3)}%；单次 push p99 ${result.warmP99PushMs.toFixed(
        2,
      )}ms／均摊 ${result.avgPushMs.toFixed(
        3,
      )}ms／峰值 ${result.maxPushMs.toFixed(2)}ms，总耗时 ${result.totalMs.toFixed(
        0,
      )}ms`,
    );
    expect(errorRate).toBeLessThanOrEqual(0.01);
    expect(result.medianPushMs).toBeLessThanOrEqual(ASSERT_MEDIAN_PUSH_MS);
    expect(result.avgPushMs).toBeLessThanOrEqual(ASSERT_AVG_PUSH_MS);
    expect(result.maxPushMs).toBeLessThanOrEqual(ASSERT_MAX_PUSH_MS);
  });

  it('英文长文（≥3,000 字符）：相对全量 encode 误差 ≤3%', () => {
    expect(EN_PASSAGE.length).toBeGreaterThanOrEqual(3_000);
    const truth = encodeFull(ranksOf(cl100kRanksModule), EN_PASSAGE);
    const result = streamThrough(EN_PASSAGE);
    const errorRate = Math.abs(result.tokens - truth) / truth;
    console.log(
      `[②英文] 真值 ${truth} t，估算 ${result.tokens} t，误差 ${(
        errorRate * 100
      ).toFixed(3)}%；单次 push p99 ${result.warmP99PushMs.toFixed(
        2,
      )}ms／均摊 ${result.avgPushMs.toFixed(
        3,
      )}ms／峰值 ${result.maxPushMs.toFixed(2)}ms，总耗时 ${result.totalMs.toFixed(
        0,
      )}ms`,
    );
    expect(errorRate).toBeLessThanOrEqual(0.03);
    expect(result.medianPushMs).toBeLessThanOrEqual(ASSERT_MEDIAN_PUSH_MS);
    expect(result.avgPushMs).toBeLessThanOrEqual(ASSERT_AVG_PUSH_MS);
    expect(result.maxPushMs).toBeLessThanOrEqual(ASSERT_MAX_PUSH_MS);
  });

  it('纯中文无空白超长串：单次 push 不退化成数十毫秒（拆段自保）', () => {
    const counter = createStreamTokenEstimator({vendorModelId: null})!;
    expect(counter).not.toBeNull();
    // 12,000 字符一次涌入（真实 tiktoken 全量 encode 是 88s 量级）。
    const pushStartedAt = performance.now();
    counter.push('中文测试内容连续书写没有空白也不换行'.repeat(500).slice(0, 12_000));
    void counter.tokens;
    const elapsed = performance.now() - pushStartedAt;
    console.log(`[②无空白串] 12,000 字符单次 push ${elapsed.toFixed(1)}ms`);
    // 真实 tiktoken 全量 encode 该长度是 88s 量级；这里按 ≤64 字符拆段后应在
    // 百毫秒量级（Node 实测 ~0.5s，主要成本是 187 次 64 字符纯 CJK encode）。
    expect(elapsed).toBeLessThan(2_000);
    expect(counter.tokens).toBeGreaterThan(0);
  });

  it('每条估算器状态独立：reset 归零、互不串值', () => {
    const a = createStreamTokenEstimator()!;
    const b = createStreamTokenEstimator()!;
    a.push('hello world');
    expect(a.tokens).toBeGreaterThan(0);
    expect(b.tokens).toBe(0);
    a.reset();
    expect(a.tokens).toBe(0);
    expect(b.tokens).toBe(0);
  });

  it('编码名解析：o200k 家族 vs cl100k 兜底', () => {
    expect(resolveStreamTokenEncodingName('gpt-4o')).toBe('o200k_base');
    expect(resolveStreamTokenEncodingName('gpt-5')).toBe('o200k_base');
    expect(resolveStreamTokenEncodingName('openai/gpt-4o-mini')).toBe(
      'o200k_base',
    );
    expect(resolveStreamTokenEncodingName('gpt-4')).toBe('cl100k_base');
    expect(resolveStreamTokenEncodingName('gpt-3.5-turbo')).toBe(
      'cl100k_base',
    );
    // 非 tiktoken 家族（claude/qwen/glm/gemini）本轮统一按 cl100k 估算。
    expect(resolveStreamTokenEncodingName('claude-3-5-sonnet')).toBe(
      'cl100k_base',
    );
    expect(resolveStreamTokenEncodingName('qwen2.5-72b')).toBe('cl100k_base');
    expect(resolveStreamTokenEncodingName('glm-4-plus')).toBe('cl100k_base');
    expect(resolveStreamTokenEncodingName(null)).toBe('cl100k_base');
    expect(resolveStreamTokenEncodingName('')).toBe('cl100k_base');
  });

  it('会话估算器：仓储解析出的 vendorModelId 决定编码（o200k 家族走 o200k 表）', async () => {
    const runtime: StreamTokenModelHintRuntime = {
      sessions: {
        getSessionAgentConfig: async () => ({agentId: 'a1'}),
      },
      agentRegistry: {
        get: async () => ({model: 'saved-1'}),
      },
      providerModels: {
        getSavedById: async () => ({vendorModelId: 'gpt-5'}),
      },
    };
    primeStreamTokenModelHint(runtime, 'session-o200k');
    // 让三层异步仓储解析落地（microtask 链）。
    await new Promise(resolve => setTimeout(resolve, 0));

    const counter = createSessionStreamTokenEstimator(runtime, 'session-o200k');
    expect(counter).not.toBeNull();
    const text = '中文测试内容';
    counter!.push(text);
    const expected = encodeFull(ranksOf(o200kRanksModule), text);
    expect(counter!.tokens).toBe(expected);
  });

  it('会话估算器：解析失败/缺配置时按 cl100k 兜底，不抛错', async () => {
    const runtime: StreamTokenModelHintRuntime = {
      sessions: {
        getSessionAgentConfig: async () => {
          throw new Error('session missing');
        },
      },
      agentRegistry: {
        get: async () => ({}),
      },
      providerModels: {
        getSavedById: async () => null,
      },
    };
    const counter = createSessionStreamTokenEstimator(runtime, 'session-broken');
    expect(counter).not.toBeNull();
    counter!.push('a b c');
    expect(counter!.tokens).toBeGreaterThan(0);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
});

/**
 * 会话级提示缓存的时效（cr-fix-spec metrics/C-2）。
 *
 * `vendorModelHintBySession` 是模块私有 Map、没有 `__test__` 导出，因此这两条
 * 走**可观测代理**：观察「读口 `createSessionStreamTokenEstimator` 建出来的是
 * 哪张编码表」与「`runtime.sessions.getSessionAgentConfig` 的调用计数」。
 */
describe('会话级 vendorModelId 提示缓存的 TTL（metrics/C-2）', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** 造一个仓储口径 runtime；`setVendorModelId` 用于模拟「用户在会话内换模型」。 */
  function createRuntime(initialVendorModelId: string): {
    readonly runtime: StreamTokenModelHintRuntime;
    readonly getSessionAgentConfig: jest.Mock<() => Promise<{agentId: string}>>;
    readonly setVendorModelId: (id: string) => void;
  } {
    let vendorModelId = initialVendorModelId;
    const getSessionAgentConfig = jest.fn(async () => ({agentId: 'a1'}));
    const runtime: StreamTokenModelHintRuntime = {
      sessions: {getSessionAgentConfig},
      agentRegistry: {get: async () => ({model: 'saved-1'})},
      providerModels: {
        getSavedById: async () => ({vendorModelId}),
      },
    };
    return {
      runtime,
      getSessionAgentConfig,
      setVendorModelId: id => {
        vendorModelId = id;
      },
    };
  }

  it('过期条目不被采信：读口走 cl100k 兜底，重新 prime 后取到新值', async () => {
    const {runtime, setVendorModelId} = createRuntime('gpt-5');
    primeStreamTokenModelHint(runtime, 'session-ttl');
    await new Promise(resolve => setTimeout(resolve, 0));

    // TTL 内：提示被采信，走 o200k 编码表。
    const before = createSessionStreamTokenEstimator(runtime, 'session-ttl')!;
    before.push('中文测试内容');
    expect(before.tokens).toBe(
      encodeFull(ranksOf(o200kRanksModule), '中文测试内容'),
    );

    // 同一会话内换成 cl100k 家族模型 + 时钟越过 10 分钟 TTL：只有「过期条目
    // 不被采信」才看得到这个换模（否则会继续按旧 o200k 编码估算）。
    setVendorModelId('gpt-3.5-turbo');
    const realNowMs = Date.now();
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(realNowMs + 11 * 60_000);
    try {
      // 读口判定过期 → 不采信旧提示 → 按 cl100k 起算，并顺手踢一次 prime。
      const stale = createSessionStreamTokenEstimator(runtime, 'session-ttl')!;
      stale.push('中文测试内容');
      expect(stale.tokens).toBe(
        encodeFull(ranksOf(cl100kRanksModule), '中文测试内容'),
      );

      // 重新 prime 落地后（条目已被淘汰，prime 的 has 守卫放行）取到新值
      // ——与过期前那条 o200k 计数器逐 token 相同 ⟺ 换模真的被看见了。
      await new Promise(resolve => setTimeout(resolve, 0));
      const fresh = createSessionStreamTokenEstimator(runtime, 'session-ttl')!;
      fresh.push('中文测试内容');
      expect(fresh.tokens).toBe(stale.tokens);
      expect(fresh.tokens).toBe(
        encodeFull(ranksOf(cl100kRanksModule), '中文测试内容'),
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('过期条目已从 Map 淘汰：读口之后 getSessionAgentConfig 计数 +1（代理断言）', async () => {
    const {runtime, getSessionAgentConfig} = createRuntime('gpt-5');
    primeStreamTokenModelHint(runtime, 'session-ttl-delete');
    await new Promise(resolve => setTimeout(resolve, 0));
    // 预热已解析过一轮，计数为 1；此后不再有仓储调用。
    expect(getSessionAgentConfig).toHaveBeenCalledTimes(1);

    const realNowMs = Date.now();
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(realNowMs + 11 * 60_000);
    try {
      // 读口命中但过期 → 判定为未命中并踢一次 prime。
      createSessionStreamTokenEstimator(runtime, 'session-ttl-delete');
      await new Promise(resolve => setTimeout(resolve, 0));

      // `getSessionAgentConfig` 只在 `resolveStreamTokenVendorModelId` 里被调，
      // 而 prime 的早退守卫是 `has()`。计数 +1 ⟺ 过期条目已从 Map 里 delete
      // ⟺ has() 放行了。删掉 `readVendorModelHint` 里的 delete，这条必红。
      expect(getSessionAgentConfig).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
