/**
 * r3-orc-1：runCompactionWithTokenWarm 编排单测。
 *
 * 被测的编排层与被它驱动的 token 冻结层（`chat-prompt-tokens.service` 的
 * preciseWarmInflight 计数）都走**真实现**——本套件只 mock 掉最底层的
 * `runCompaction` 与整串计数驱动。否则「计数配对」根本测不到：真编排 +
 * 假 token 层的话，Map 计数退回 Set 也一样全绿。
 */
import {describe, expect, it, jest, beforeEach} from '@jest/globals';

import {
  beginChatTokenLabelFreeze,
  endChatTokenLabelFreeze,
  isChatTokenPreciseWarmInflight,
  warmChatTokenLabelAfterCompaction,
} from '@/services/chat-prompt-tokens.service';
import {runCompactionWithTokenWarm} from '@/services/compaction-warm-orchestration.service';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

const mockRunCompaction = jest.fn();
const mockGetHideStartDepth = jest.fn();
const mockResolvePromptTokensWithBackfill = jest.fn();
const mockResolveTokenCounterModeForModel = jest.fn();
const mockBuildSessionPromptInput = jest.fn();
const mockResolveSavedModelId = jest.fn();

jest.mock('@novel-master/core/compaction', () => ({
  runCompaction: (...args: unknown[]) => mockRunCompaction(...args),
}));

jest.mock('@novel-master/tokenizer-driver-rn/encoding', () => ({
  countTextWithDefaultEncoding: () => 2345,
}));

jest.mock('@novel-master/core/provider', () => {
  class PromptTokenResolveBailedError extends Error {}
  return {
    resolvePromptTokensWithBackfill: (...args: unknown[]) =>
      mockResolvePromptTokensWithBackfill(...args),
    resolveTokenCounterModeForModel: (...args: unknown[]) =>
      mockResolveTokenCounterModeForModel(...args),
    serializePromptLlmInput: () => 'serialized',
    PromptTokenResolveBailedError,
  };
});

jest.mock('@novel-master/core/agent', () => ({
  resolveSavedModelId: (...args: unknown[]) => mockResolveSavedModelId(...args),
}));

jest.mock('@novel-master/core/prompt', () => ({
  messageBodyText: () => 'hello',
}));

jest.mock('@/services/session-prompt-input.service', () => {
  class ChatPromptBuildBailedError extends Error {}
  return {
    buildSessionPromptInput: (...args: unknown[]) =>
      mockBuildSessionPromptInput(...args),
    ChatPromptBuildBailedError,
  };
});

function stubRuntime(): MobileNovelMasterRuntime {
  return {
    compactionConditionEvaluator: {
      getHideStartDepth: (...args: unknown[]) =>
        mockGetHideStartDepth(...args),
    },
    sessionKkv: {get: jest.fn(), set: jest.fn(), delete: jest.fn()},
    messages: {listBySession: jest.fn()},
    messageTranscriptEffects: {},
    providerModels: {getContextWindow: jest.fn().mockResolvedValue(128_000)},
    tokenCounters: {heuristic: {countText: jest.fn().mockReturnValue(1000)}},
    sessions: {getSessionAgentConfig: jest.fn().mockResolvedValue({})},
    abortRegistry: {has: jest.fn().mockReturnValue(false)},
  } as unknown as MobileNovelMasterRuntime;
}

/** 让整串计数挂住，用手动闸门控制预热的落定时机。 */
function gateWarm(): {release: () => void; reached: Promise<void>} {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const reached = gate.then(() => ({
    tokenCount: 99_300,
    estimated: false,
    counterKind: 'glm',
    source: 'local',
  }));
  mockResolvePromptTokensWithBackfill.mockImplementation(async () => await reached);
  return {release, reached: Promise.resolve()};
}

describe('runCompactionWithTokenWarm（r3-orc-1）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHideStartDepth.mockResolvedValue(3);
    mockRunCompaction.mockResolvedValue({ok: true});
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {model: 'zai/glm-4.6'},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });
    mockResolveSavedModelId.mockReturnValue('zai/glm-4.6');
    mockResolveTokenCounterModeForModel.mockResolvedValue('glm');
    mockResolvePromptTokensWithBackfill.mockResolvedValue({
      tokenCount: 99_300,
      estimated: false,
      counterKind: 'glm',
      source: 'local',
    });
  });

  it('成功：预热 await 落定后解冻；冻结标志三种结局都归 false', async () => {
    const order: string[] = [];
    await runCompactionWithTokenWarm(stubRuntime(), {projectId: 'p', sessionId: 's-ok'}, {
      onSucceeded: () => {
        order.push('succeeded');
      },
      onFinally: outcome => {
        order.push(`finally:${outcome.ok}`);
      },
    });
    expect(mockRunCompaction).toHaveBeenCalledTimes(1);
    expect(isChatTokenPreciseWarmInflight('s-ok')).toBe(false);
    // 预热在解冻之前落定：钩子跑在解冻之后，故顺序是 succeeded → finally。
    expect(order).toEqual(['succeeded', 'finally:true']);
  });

  it('压缩本体返回失败：不预热、标志归 false、只走 onFailed + onFinally', async () => {
    mockRunCompaction.mockResolvedValue({ok: false});
    const onSucceeded = jest.fn();
    const onFailed = jest.fn();
    const onFinally = jest.fn();
    await runCompactionWithTokenWarm(stubRuntime(), {projectId: 'p', sessionId: 's-fail'}, {
      onSucceeded,
      onFailed,
      onFinally,
    });
    expect(mockResolvePromptTokensWithBackfill).not.toHaveBeenCalled();
    expect(isChatTokenPreciseWarmInflight('s-fail')).toBe(false);
    expect(onSucceeded).not.toHaveBeenCalled();
    // 明确失败 → error 为 undefined（调用方据此区分「没重载消息面」的抛错出口）
    expect(onFailed).toHaveBeenCalledWith(undefined);
    expect(onFinally).toHaveBeenCalledWith({ok: false, error: undefined});
  });

  it('压缩链抛错：错误原样透传给 onFailed，标志仍归 false（不卡死冻结）', async () => {
    const boom = new Error('compaction boom');
    mockRunCompaction.mockRejectedValue(boom);
    const onFailed = jest.fn();
    const onFinally = jest.fn();
    await runCompactionWithTokenWarm(stubRuntime(), {projectId: 'p', sessionId: 's-throw'}, {
      onFailed,
      onFinally,
    });
    expect(isChatTokenPreciseWarmInflight('s-throw')).toBe(false);
    expect(onFailed).toHaveBeenCalledWith(boom);
    expect(onFinally).toHaveBeenCalledWith({ok: false, error: boom});
  });

  it('getHideStartDepth 抛错也归 false（冻结在 runCompaction 之前就已开）', async () => {
    const boom = new Error('evaluator boom');
    mockGetHideStartDepth.mockRejectedValue(boom);
    const onFailed = jest.fn();
    await runCompactionWithTokenWarm(stubRuntime(), {projectId: 'p', sessionId: 's-depth'}, {
      onFailed,
    });
    expect(mockRunCompaction).not.toHaveBeenCalled();
    expect(isChatTokenPreciseWarmInflight('s-depth')).toBe(false);
    expect(onFailed).toHaveBeenCalledWith(boom);
  });

  it('成功链途中：begin 与预热两路都在途时标志为真，两路落定后才归 false', async () => {
    const {release} = gateWarm();
    const done = runCompactionWithTokenWarm(
      stubRuntime(),
      {projectId: 'p', sessionId: 's-inflight'},
      {},
    );
    // 等压缩本体 + 预热起步（build/resolve 派发前的几个 await）。
    for (let i = 0; i < 12; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    // 预热在途：begin 的 ++ 与预热的 ++ 叠加，解冻等两路落定 → 仍为真。
    expect(isChatTokenPreciseWarmInflight('s-inflight')).toBe(true);
    release();
    await done;
    expect(isChatTokenPreciseWarmInflight('s-inflight')).toBe(false);
  });

  it('计数配对：预热落定只减它自己那一份，编排层的持有不被顺带清掉', async () => {
    // 编排层先开窗（+1），预热再起步（+1 → 2）。
    beginChatTokenLabelFreeze('s-pair');
    const {release} = gateWarm();
    const warm = warmChatTokenLabelAfterCompaction(stubRuntime(), {
      projectId: 'p',
      sessionId: 's-pair',
    });
    for (let i = 0; i < 12; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(isChatTokenPreciseWarmInflight('s-pair')).toBe(true);
    // 预热落定：它自己的 finally 只减 1（2 → 1），编排层那份还在 → 仍为真。
    // 这正是 Map 计数要保住的不变式：Set 的 delete 会把两路一起清掉，
    // 编排链尚未收尾时就提前解冻 → 跳变回归。
    release();
    await warm;
    expect(isChatTokenPreciseWarmInflight('s-pair')).toBe(true);
    // 编排层收尾（-1 → 0）才真解冻。
    endChatTokenLabelFreeze('s-pair');
    expect(isChatTokenPreciseWarmInflight('s-pair')).toBe(false);
  });

  it('计数不越界：多余的 end 不会造出负数键', async () => {
    endChatTokenLabelFreeze('s-extra');
    expect(isChatTokenPreciseWarmInflight('s-extra')).toBe(false);
    // 归零后再开一扇窗仍是干净的一次 +1/-1。
    beginChatTokenLabelFreeze('s-extra');
    expect(isChatTokenPreciseWarmInflight('s-extra')).toBe(true);
    endChatTokenLabelFreeze('s-extra');
    expect(isChatTokenPreciseWarmInflight('s-extra')).toBe(false);
  });

  it('预热独立调用（无编排层）自身配对：起步为真、落定归 false', async () => {
    const {release} = gateWarm();
    const warm = warmChatTokenLabelAfterCompaction(stubRuntime(), {
      projectId: 'p',
      sessionId: 's-warm-alone',
    });
    for (let i = 0; i < 12; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(isChatTokenPreciseWarmInflight('s-warm-alone')).toBe(true);
    release();
    await warm;
    expect(isChatTokenPreciseWarmInflight('s-warm-alone')).toBe(false);
  });

  it('预热内部失败静默吞错且标志必清（压缩流程不受影响）', async () => {
    mockBuildSessionPromptInput.mockRejectedValue(new Error('build boom'));
    const onSucceeded = jest.fn();
    const onFinally = jest.fn();
    await runCompactionWithTokenWarm(stubRuntime(), {projectId: 'p', sessionId: 's-warmfail'}, {
      onSucceeded,
      onFinally,
    });
    expect(onSucceeded).toHaveBeenCalledTimes(1);
    expect(onFinally).toHaveBeenCalledWith({ok: true, error: undefined});
    expect(isChatTokenPreciseWarmInflight('s-warmfail')).toBe(false);
  });

  it('成功尾巴自身抛错：补一次 onFailed；onFinally 不跑（旧码同样不跑 load()）', async () => {
    const boom = new Error('tail boom');
    const onFailed = jest.fn();
    const onFinally = jest.fn();
    await runCompactionWithTokenWarm(stubRuntime(), {projectId: 'p', sessionId: 's-tail'}, {
      onSucceeded: () => {
        throw boom;
      },
      onFailed,
      onFinally,
    });
    expect(onFailed).toHaveBeenCalledWith(boom);
    // 旧手工副本：成功分支抛错直接进 catch，`await load()` / 补发那一段被跳过。
    expect(onFinally).not.toHaveBeenCalled();
    expect(isChatTokenPreciseWarmInflight('s-tail')).toBe(false);
  });

  it('失败尾巴自身抛错：不连弹两条（onFailed 只被调用一次）', async () => {
    mockRunCompaction.mockResolvedValue({ok: false});
    const onFailed = jest.fn(() => {
      throw new Error('toast boom');
    });
    const onFinally = jest.fn();
    await runCompactionWithTokenWarm(stubRuntime(), {projectId: 'p', sessionId: 's-tailfail'}, {
      onFailed,
      onFinally,
    });
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(isChatTokenPreciseWarmInflight('s-tailfail')).toBe(false);
  });

  it('冻结窗口先于 runCompaction 打开：runCompaction 被调那一刻标志已为真', async () => {
    // 时序不变式（模块头注释第 1 条）的牙齿：冻结若被挪到 runCompaction 之后，
    // 压缩过程的转录事件会先触发 chip 估算刷新（2026-09-30 真机实锤的跳变形态）。
    let flagAtCompaction: boolean | null = null;
    mockRunCompaction.mockImplementation(async () => {
      flagAtCompaction = isChatTokenPreciseWarmInflight('s-freeze-order');
      return {ok: false};
    });
    await runCompactionWithTokenWarm(stubRuntime(), {projectId: 'p', sessionId: 's-freeze-order'}, {});
    expect(flagAtCompaction).toBe(true);
    expect(isChatTokenPreciseWarmInflight('s-freeze-order')).toBe(false);
  });

  it('成功尾巴抛错且兜底 onFailed 也抛错：兜底的兜底吞掉，仍不外抛', async () => {
    // 「不外抛异常」契约的最后一道出口：调用方是 void 调用，这里逃出去就是
    // unhandled rejection。修复前（外层 catch 里裸 await onFailed）本用例会
    // 以 rejection 形态失败。
    const tailBoom = new Error('tail boom');
    const onFailed = jest.fn(() => {
      throw new Error('toast boom');
    });
    const onFinally = jest.fn();
    await runCompactionWithTokenWarm(stubRuntime(), {projectId: 'p', sessionId: 's-tailboom'}, {
      onSucceeded: () => {
        throw tailBoom;
      },
      onFailed,
      onFinally,
    });
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith(tailBoom);
    expect(isChatTokenPreciseWarmInflight('s-tailboom')).toBe(false);
  });
});
