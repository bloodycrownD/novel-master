import {
  formatContextUsageLabel,
  formatTokenSourceBadge,
} from '@novel-master/core/common';
import {
  __setPreciseUpgradeDelayForTests,
  cancelPreciseUpgradeDelay,
  isChatTokenPreciseWarmInflight,
  loadChatPromptTokenLabel,
  loadChatPromptTokenLabelResilient,
  PRECISE_UPGRADE_START_DELAY_MS,
  warmChatTokenLabelAfterCompaction,
} from '@/services/chat-prompt-tokens.service';
// jest.mock 拦截后这里拿到的是工厂里的同构类——被测服务的 instanceof 与
// 测试里 throw 的实例同源（中途弃权用例的观测前提）。
import {ChatPromptBuildBailedError} from '@/services/session-prompt-input.service';
import {PromptTokenResolveBailedError} from '@novel-master/core/provider';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

const mockResolvePromptTokensWithBackfill = jest.fn();
const mockResolveTokenCounterModeForModel = jest.fn();
const mockBuildSessionPromptInput = jest.fn();
const mockResolveSavedModelId = jest.fn();
// 形参写成 rest（而非零参实现）：mock 工厂里要把 unknown[] 原样转发进来，
// 零参签名会让 tsc 报 TS2556（spread 必须有 tuple/ rest 目标）——既有的类型
// 欠账，本轮顺手清掉，免得本文件的 typecheck 信号被这一条常年占着。
const mockSerializePromptLlmInput = jest.fn((..._args: unknown[]) => 'serialized');
// 兜底路径（无模型早退 / build 失败）改走 RN 驱动的 cl100k 真分词器，不再走
// `tokenCounters.heuristic.countText`。本套件整体 mock 掉了 `@novel-master/core/provider`，
// 驱动的 encoding 子模块要从那里取 core 的计数 helper，因此这里连驱动一起 mock
// 成可控值：既能钉住「确实没再走折算」，又不至于把整个 js-tiktoken 拉进单测。
const mockCountTextWithDefaultEncoding = jest.fn((text: string) => 2345);

jest.mock('@novel-master/tokenizer-driver-rn/encoding', () => ({
  countTextWithDefaultEncoding: (text: string) =>
    mockCountTextWithDefaultEncoding(text),
}));

// badge/label 走 `@novel-master/core/common` 取 core 真实现（不被本 mock 覆盖），
// 因此本套件断言的标签字符串与 desktop 测试同源对拍（token-source-label T-TL4）。
jest.mock('@novel-master/core/provider', () => {
  // 与 core 真身同构的 resolve 段弃权错误类（r3-chip-1）：被测服务按
  // instanceof 识别「resolve 段中途弃权」，mock 工厂必须给同一个类。
  class PromptTokenResolveBailedError extends Error {
    constructor() {
      super('prompt token resolve bailed (run in flight)');
      this.name = 'PromptTokenResolveBailedError';
    }
  }
  return {
    resolvePromptTokensWithBackfill: (...args: unknown[]) =>
      mockResolvePromptTokensWithBackfill(...args),
    resolveTokenCounterModeForModel: (...args: unknown[]) =>
      mockResolveTokenCounterModeForModel(...args),
    serializePromptLlmInput: (...args: unknown[]) =>
      mockSerializePromptLlmInput(...args),
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
  // 与真身同构的弃权错误类：被测服务按 instanceof 识别，mock 工厂必须
  // 提供同一个类（真身类在 jest.mock 下不可达）。
  class ChatPromptBuildBailedError extends Error {
    constructor() {
      super('chat prompt build bailed (run in flight)');
      this.name = 'ChatPromptBuildBailedError';
    }
  }
  return {
    buildSessionPromptInput: (...args: unknown[]) =>
      mockBuildSessionPromptInput(...args),
    ChatPromptBuildBailedError,
  };
});

function stubRuntime(overrides?: {
  tokenCounterMode?: string;
  contextWindow?: number | null;
  /** abortRegistry.has 的返回值（run 在途抑制测试用）。 */
  runInFlight?: boolean;
}): MobileNovelMasterRuntime {
  return {
    state: {
      getCurrentModelId: jest.fn().mockResolvedValue('openai/gpt-4o'),
    },
    providerModels: {
      getContextWindow: jest
        .fn()
        .mockResolvedValue(overrides?.contextWindow ?? 128_000),
      getTokenCounterMode: jest
        .fn()
        .mockResolvedValue(overrides?.tokenCounterMode ?? 'auto'),
    },
    tokenCounters: {
      heuristic: {countText: jest.fn().mockReturnValue(1000)},
    },
    sessions: {
      getSessionAgentConfig: jest.fn().mockResolvedValue({}),
    },
    messages: {listBySession: jest.fn()},
    // 读口会把它透传给 core 的 resolvePromptTokensWithBackfill（跨重启取 API 值）
    sessionKkv: {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      delete: jest.fn(),
      clearDomain: jest.fn(),
      clearSession: jest.fn(),
      listKeys: jest.fn().mockResolvedValue([]),
    },
    // run 在途抑制（chat-prompt-tokens.service 两阶段门控）需要 abortRegistry.has
    abortRegistry: {
      has: jest.fn().mockReturnValue(overrides?.runInFlight ?? false),
      abort: jest.fn(),
    },
  } as unknown as MobileNovelMasterRuntime;
}

describe('chat-prompt-tokens.service', () => {
  beforeEach(() => {
    mockResolvePromptTokensWithBackfill.mockReset();
    mockResolveTokenCounterModeForModel.mockReset();
    mockBuildSessionPromptInput.mockReset();
    mockResolveSavedModelId.mockReset();
    mockSerializePromptLlmInput.mockClear();
    mockCountTextWithDefaultEncoding.mockClear();
    // 存量两阶段用例在微任务节奏下断言升级轮：置 0 = 立即启动（旧行为）。
    // 「延迟启动/视图弃权」的专项用例在自己体内还原默认值再调回。
    __setPreciseUpgradeDelayForTests(0);
  });

  afterEach(() => {
    // 兜底还原：新用例若因超时被 jest 强杀，try/finally 不保证执行，
    // 假计时器残留会让后续所有用例的 setImmediate 等待挂死（连环超时）。
    jest.useRealTimers();
    __setPreciseUpgradeDelayForTests(PRECISE_UPGRADE_START_DELAY_MS);
  });

  it('T-TL4 对拍：service 输出与 core 单源（badge + label）重算一致（家族精确档）', () => {
    const result = {
      tokenCount: 24_000,
      estimated: false,
      counterKind: 'gemma',
      source: 'local' as const,
    };
    const contextWindow = 128_000;
    const badge = formatTokenSourceBadge(
      result.source,
      result.counterKind,
      result.estimated,
    );
    // 与 desktop T-T9b 同口径：local + 家族名 + est=false → 家族展示名 =。
    expect(badge).toEqual({mark: 'gemma', connector: '='});
    expect(
      formatContextUsageLabel(result.tokenCount, contextWindow, badge),
    ).toBe('gemma = 24k / 128k (19%)');
  });

  it('loadChatPromptTokenLabel 家族精确档：gemma = 24k / 128k (19%)', async () => {
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {model: 'openai/gpt-4o'},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });
    mockResolveSavedModelId.mockReturnValue('openai/gpt-4o');
    mockResolveTokenCounterModeForModel.mockResolvedValue('gemma');
    mockResolvePromptTokensWithBackfill.mockResolvedValue({
      tokenCount: 24_000,
      estimated: false,
      counterKind: 'gemma',
      source: 'local',
    });

    const runtime = stubRuntime();
    const label = await loadChatPromptTokenLabel(runtime, {
      sessionId: 's1',
      projectId: 'p1',
    });

    expect(label).toBe('gemma = 24k / 128k (19%)');
    expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledWith(
      's1',
      // rawMessages 已无实际用途（回填废弃），仅签名兼容保留；mock bundle 不携带时为 undefined
      undefined,
      expect.objectContaining({tokenizerOverride: 'gemma'}),
      // 第 4 参透传 sessionKkv：读口据此取跨重启的 API 值
      {sessionKkv: runtime.sessionKkv},
    );
  });

  it('T-T9: source===api ⇒ label 记号「远程 =」且无估算符', async () => {
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {model: 'openai/gpt-4o'},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });
    mockResolveSavedModelId.mockReturnValue('openai/gpt-4o');
    mockResolveTokenCounterModeForModel.mockResolvedValue('auto');
    mockResolvePromptTokensWithBackfill.mockResolvedValue({
      tokenCount: 24_000,
      estimated: false,
      counterKind: 'api',
      source: 'api',
    });

    const label = await loadChatPromptTokenLabel(stubRuntime(), {
      sessionId: 's1',
      projectId: 'p1',
    });

    expect(label).toBe('远程 = 24k / 128k (19%)');
  });

  it('T-S6: service 把 buildSessionPromptInput 返回的 rawMessages 透传给 resolvePromptTokensWithBackfill', async () => {
    // 构造一个可识别的 rawMessages，验证它作为第二参被透传。
    const rawMessages = [
      {
        id: 'm1',
        role: 'user',
        content: {blocks: [{type: 'text', text: 'hi'}]},
        hidden: false,
      },
    ];
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {model: 'openai/gpt-4o'},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
      rawMessages,
    });
    mockResolveSavedModelId.mockReturnValue('openai/gpt-4o');
    mockResolveTokenCounterModeForModel.mockResolvedValue('auto');
    mockResolvePromptTokensWithBackfill.mockResolvedValue({
      tokenCount: 24_000,
      estimated: false,
      counterKind: 'api',
      source: 'api',
    });

    await loadChatPromptTokenLabel(stubRuntime(), {
      sessionId: 's1',
      projectId: 'p1',
    });

    expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledTimes(1);
    const callArgs = mockResolvePromptTokensWithBackfill.mock.calls[0];
    // [0]=sessionId, [1]=rawMessages, [2]=params, [3]=options（透传 sessionKkv）
    expect(callArgs[0]).toBe('s1');
    expect(callArgs[1]).toBe(rawMessages);
    expect(callArgs[3]).toEqual({
      sessionKkv: expect.objectContaining({get: expect.any(Function)}),
    });
  });

  it('无模型早退：改走 cl100k 真计数，label 记号 gpt ≈', async () => {
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });
    mockResolveSavedModelId.mockReturnValue(undefined);

    const runtime = stubRuntime();
    const label = await loadChatPromptTokenLabel(runtime, {
      sessionId: 's1',
      projectId: 'p1',
    });

    // 折算 port（stub 里恒返回 1000）一次都不该被碰——碰了就说明改造没生效。
    expect(runtime.tokenCounters.heuristic.countText).not.toHaveBeenCalled();
    expect(mockCountTextWithDefaultEncoding).toHaveBeenCalledWith('serialized');
    // 无窗口 + heuristic 兜底 → gpt ≈ N tokens（无 ~ 前缀、无 (est.) 后缀）。
    expect(label).toBe('gpt ≈ 2.3k tokens');
    expect(label).not.toMatch(/^~/);
    expect(label).not.toContain('预估');
  });

  it('T7: loadChatPromptTokenLabelResilient 构建失败时兜底也改走真分词器', async () => {
    mockBuildSessionPromptInput.mockRejectedValue(
      new Error('prompt build failed'),
    );
    const runtime = stubRuntime({contextWindow: null});
    (runtime.state.getCurrentModelId as jest.Mock).mockResolvedValue('');
    (runtime.messages.listBySession as jest.Mock).mockResolvedValue([
      {
        role: 'user',
        content: {blocks: [{type: 'text', text: 'hello'}]},
        hidden: false,
      },
    ]);

    const label = await loadChatPromptTokenLabelResilient(runtime, {
      sessionId: 's1',
      projectId: 'p1',
    });

    expect(runtime.tokenCounters.heuristic.countText).not.toHaveBeenCalled();
    expect(mockCountTextWithDefaultEncoding).toHaveBeenCalledWith(
      'user: hello',
    );
    expect(label).toBe('gpt ≈ 2.3k tokens');
  });

  it('兜底：真分词器不可用（编码表建不起来）时才退回 heuristic.countText', async () => {
    mockCountTextWithDefaultEncoding.mockReturnValueOnce(null as never);
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });
    mockResolveSavedModelId.mockReturnValue(undefined);

    const runtime = stubRuntime();
    const label = await loadChatPromptTokenLabel(runtime, {
      sessionId: 's1',
      projectId: 'p1',
    });

    expect(runtime.tokenCounters.heuristic.countText).toHaveBeenCalledWith(
      'serialized',
    );
    expect(label).toBe('gpt ≈ 1k tokens');
  });

  it('T-S7（重写）：tiktoken 精确档与 heuristic 兜底档的记号分档（旧 formatCounterKindLabel 已退役）', () => {
    // 旧断言（api/heuristic → 「自动」）随 format-counter-kind-label 退役删除；
    // 新体系下同输入的记号断言（与 core T-TL1 单源映射一致）。
    expect(formatTokenSourceBadge('local', 'tiktoken', false)).toEqual({
      mark: 'gpt',
      connector: '=',
    });
    expect(formatTokenSourceBadge('local', 'heuristic', true)).toEqual({
      mark: 'gpt',
      connector: '≈',
    });
  });

  it('两阶段：首帧估算即回 + 后台精确升级回调（切模型后不再干等原生计数）', async () => {
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {model: 'zai/glm-4.6'},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });
    mockResolveSavedModelId.mockReturnValue('zai/glm-4.6');
    mockResolveTokenCounterModeForModel.mockResolvedValue('glm');
    mockResolvePromptTokensWithBackfill.mockImplementation(
      (_sid: string, _raw: unknown, _params: unknown, options?: unknown) => {
        const preferEstimate = (options as {preferEstimate?: boolean} | undefined)
          ?.preferEstimate;
        if (preferEstimate === true) {
          return Promise.resolve({
            tokenCount: 30_000,
            estimated: true,
            counterKind: 'heuristic',
            source: 'local',
          });
        }
        return Promise.resolve({
          tokenCount: 99_300,
          estimated: false,
          counterKind: 'glm',
          source: 'local',
        });
      },
    );

    const runtime = stubRuntime({contextWindow: 128_000});
    const upgrades: string[] = [];
    const first = await loadChatPromptTokenLabelResilient(
      runtime,
      {projectId: 'p', sessionId: 's-two-phase'},
      label => {
        upgrades.push(label);
      },
    );
    // 首帧：CJK 感知估算档（gpt ≈）立即返回，不等原生整串计数
    expect(first).toBe('gpt ≈ 30k / 128k (23%)');
    // 首帧确实带 preferEstimate
    expect(
      (mockResolvePromptTokensWithBackfill.mock.calls[0]![3] as {preferEstimate?: boolean})
        .preferEstimate,
    ).toBe(true);

    // 后台升级轮：完整口径（家族真分词器）→ 回调换上 glm = 精确标签
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    expect(upgrades).toEqual(['glm = 99.3k / 128k (78%)']);
    expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledTimes(2);
  });

  it('升级延迟启动（2026-10-01 侧滑被堵病灶）：首帧后不立刻跑精确计数，越窗才启动', async () => {
    __setPreciseUpgradeDelayForTests(PRECISE_UPGRADE_START_DELAY_MS);
    jest.useFakeTimers();
    try {
      mockBuildSessionPromptInput.mockResolvedValue({
        definition: {model: 'zai/glm-4.6'},
        layout: {persist: [], dynamic: []},
        ctx: {workplaceDisplay: '', messages: []},
      });
      mockResolveSavedModelId.mockReturnValue('zai/glm-4.6');
      mockResolveTokenCounterModeForModel.mockResolvedValue('glm');
      mockResolvePromptTokensWithBackfill.mockImplementation(
        (_sid: string, _raw: unknown, _params: unknown, options?: unknown) => {
          const preferEstimate = (options as {preferEstimate?: boolean} | undefined)
            ?.preferEstimate;
          if (preferEstimate === true) {
            return Promise.resolve({
              tokenCount: 30_000,
              estimated: true,
              counterKind: 'heuristic',
              source: 'local',
            });
          }
          return Promise.resolve({
            tokenCount: 99_300,
            estimated: false,
            counterKind: 'glm',
            source: 'local',
          });
        },
      );
      const runtime = stubRuntime({contextWindow: 128_000});
      const upgrades: string[] = [];
      const first = await loadChatPromptTokenLabelResilient(
        runtime,
        {projectId: 'p', sessionId: 's-delay'},
        label => {
          upgrades.push(label);
        },
      );
      expect(first).toBe('gpt ≈ 30k / 128k (23%)');
      // 延迟窗口内：精确档 resolve 一次都没跑（只有首帧估算那一次）——
      // 「进会话立刻交互」的黄金窗口不与秒级整串计数竞争。
      await jest.advanceTimersByTimeAsync(2499);
      expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledTimes(1);
      // 越窗启动：完整口径跑完回调升级（fake timers 下微任务由 advance 一并 flush）
      await jest.advanceTimersByTimeAsync(1);
      expect(upgrades).toEqual(['glm = 99.3k / 128k (78%)']);
      expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
      __setPreciseUpgradeDelayForTests(0);
    }
  });

  it('延迟到期时视图已切走：shouldBailPrecise 命中，升级重活一行不跑', async () => {
    __setPreciseUpgradeDelayForTests(PRECISE_UPGRADE_START_DELAY_MS);
    jest.useFakeTimers();
    try {
      mockBuildSessionPromptInput.mockResolvedValue({
        definition: {model: 'zai/glm-4.6'},
        layout: {persist: [], dynamic: []},
        ctx: {workplaceDisplay: '', messages: []},
      });
      mockResolveSavedModelId.mockReturnValue('zai/glm-4.6');
      mockResolveTokenCounterModeForModel.mockResolvedValue('glm');
      mockResolvePromptTokensWithBackfill.mockImplementation(
        (_sid: string, _raw: unknown, _params: unknown, options?: unknown) => {
          const preferEstimate = (options as {preferEstimate?: boolean} | undefined)
            ?.preferEstimate;
          if (preferEstimate === true) {
            return Promise.resolve({
              tokenCount: 30_000,
              estimated: true,
              counterKind: 'heuristic',
              source: 'local',
            });
          }
          return Promise.resolve({
            tokenCount: 99_300,
            estimated: false,
            counterKind: 'glm',
            source: 'local',
          });
        },
      );
      // 首帧跑的时候用户还在会话里；升级启动时（越窗后）早已退出——侧滑场景
      const runtime = stubRuntime({contextWindow: 128_000});
      const upgrades: string[] = [];
      let viewOnConversation = true;
      const first = await loadChatPromptTokenLabelResilient(
        runtime,
        {projectId: 'p', sessionId: 's-bail'},
        label => {
          upgrades.push(label);
        },
        {shouldBailPrecise: () => !viewOnConversation},
      );
      expect(first).toBe('gpt ≈ 30k / 128k (23%)');
      viewOnConversation = false;
      await jest.advanceTimersByTimeAsync(PRECISE_UPGRADE_START_DELAY_MS);
      // bail 命中：精确档 resolve 没跑（仍只有首帧估算一次），无升级回调
      expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledTimes(1);
      expect(upgrades).toEqual([]);
    } finally {
      jest.useRealTimers();
      __setPreciseUpgradeDelayForTests(0);
    }
  });

  it('延迟窗口内会话身份已换（cr2-E-2）：shouldBailPrecise 在窗口中改判，越窗后升级不发生', async () => {
    // 与上一条「视图已切走」互为对照：这里**视图仍在 conversation**，唯一变的是
    // 会话身份（hook 侧 tokenLabelSessionRef 已指到别的会话）。hook 判据升级成
    // 双条件就是为了覆盖这条——只看视图的话旧会话的 2.2s 计数照跑。
    __setPreciseUpgradeDelayForTests(PRECISE_UPGRADE_START_DELAY_MS);
    jest.useFakeTimers();
    try {
      mockBuildSessionPromptInput.mockResolvedValue({
        definition: {model: 'zai/glm-4.6'},
        layout: {persist: [], dynamic: []},
        ctx: {workplaceDisplay: '', messages: []},
      });
      mockResolveSavedModelId.mockReturnValue('zai/glm-4.6');
      mockResolveTokenCounterModeForModel.mockResolvedValue('glm');
      mockResolvePromptTokensWithBackfill.mockImplementation(
        (_sid: string, _raw: unknown, _params: unknown, options?: unknown) => {
          const preferEstimate = (options as {preferEstimate?: boolean} | undefined)
            ?.preferEstimate;
          if (preferEstimate === true) {
            return Promise.resolve({
              tokenCount: 30_000,
              estimated: true,
              counterKind: 'heuristic',
              source: 'local',
            });
          }
          return Promise.resolve({
            tokenCount: 99_300,
            estimated: false,
            counterKind: 'glm',
            source: 'local',
          });
        },
      );
      const runtime = stubRuntime({contextWindow: 128_000});
      const upgrades: string[] = [];
      const inConversation = true;
      let shownSessionId = 's-identity';
      const first = await loadChatPromptTokenLabelResilient(
        runtime,
        {projectId: 'p', sessionId: 's-identity'},
        label => {
          upgrades.push(label);
        },
        // hook 侧 `chatSubviewRef.current !== 'conversation' ||
        //            tokenLabelSessionRef.current !== sessionId` 的等价物
        {shouldBailPrecise: () => !inConversation || shownSessionId !== 's-identity'},
      );
      expect(first).toBe('gpt ≈ 30k / 128k (23%)');
      // 首帧窗口内用户切到了别的会话（视图没切，仍在 conversation）
      shownSessionId = 's-other';
      await jest.advanceTimersByTimeAsync(PRECISE_UPGRADE_START_DELAY_MS);
      expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledTimes(1);
      expect(upgrades).toEqual([]);
    } finally {
      jest.useRealTimers();
      __setPreciseUpgradeDelayForTests(0);
    }
  });

  it('cancel 收口回归（cr2-E-2 硬约束）：取消挂起的延迟升级后，同会话下一轮刷新仍真升级', async () => {
    // 收口语义的牙齿：只清 timer 不清 inflight/queued 的朴素实现，会让该会话
    // 的精确升级**永久楔死在估算档**——timer 被清 ⇒ runPreciseUpgrade 永不
    // 执行 ⇒ finally（inflight/queued 的唯一清理点）永不跑 ⇒ 后续升级请求
    // 全被挡进补跑槽、无人排空。本用例的末条断言在那种实现下必红。
    __setPreciseUpgradeDelayForTests(PRECISE_UPGRADE_START_DELAY_MS);
    jest.useFakeTimers();
    try {
      mockTwoPhaseResolve(() =>
        Promise.resolve({
          tokenCount: 99_300,
          estimated: false,
          counterKind: 'glm',
          source: 'local',
        }),
      );
      const runtime = stubRuntime({contextWindow: 128_000});
      const upgrades: string[] = [];
      const first = await loadChatPromptTokenLabelResilient(
        runtime,
        {projectId: 'p', sessionId: 's-cancel'},
        l => upgrades.push(l),
      );
      expect(first).toBe('gpt ≈ 30k / 128k (23%)');
      // 延迟窗口内：升级还挂着（只有首帧那一次 resolve）。
      await jest.advanceTimersByTimeAsync(1000);
      expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledTimes(1);

      // 收口（换会话 / 卸载时 service 的正式出口）。
      cancelPreciseUpgradeDelay('s-cancel');

      // 同会话再次刷新并越窗：第二轮升级确实发生——计数从 2 次（两次首帧）
      // 走到 3 次（+ 一轮精确），回调拿到精确标签。
      const second = await loadChatPromptTokenLabelResilient(
        runtime,
        {projectId: 'p', sessionId: 's-cancel'},
        l => upgrades.push(l),
      );
      expect(second).toBe('gpt ≈ 30k / 128k (23%)');
      expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(PRECISE_UPGRADE_START_DELAY_MS);
      expect(upgrades).toEqual(['glm = 99.3k / 128k (78%)']);
      expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
      __setPreciseUpgradeDelayForTests(0);
    }
  });

  it('run 在途抑制：abortRegistry.has 为真时跳过精确升级，run 结束后的刷新补上（2026-09-30 停止失灵病灶）', async () => {
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {model: 'zai/glm-4.6'},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });
    mockResolveSavedModelId.mockReturnValue('zai/glm-4.6');
    mockResolveTokenCounterModeForModel.mockResolvedValue('glm');
    mockResolvePromptTokensWithBackfill.mockImplementation(
      (_sid: string, _raw: unknown, _params: unknown, options?: unknown) => {
        const preferEstimate = (options as {preferEstimate?: boolean} | undefined)
          ?.preferEstimate;
        if (preferEstimate === true) {
          return Promise.resolve({
            tokenCount: 30_000,
            estimated: true,
            counterKind: 'heuristic',
            source: 'local',
          });
        }
        return Promise.resolve({
          tokenCount: 99_300,
          estimated: false,
          counterKind: 'glm',
          source: 'local',
        });
      },
    );

    // run 在途（abortRegistry.has === true）：发送链正在前奏里跑
    let runInFlight = true;
    const runtime = stubRuntime({contextWindow: 128_000});
    (runtime.abortRegistry.has as jest.Mock).mockImplementation(
      () => runInFlight,
    );

    const upgrades: string[] = [];
    const first = await loadChatPromptTokenLabelResilient(
      runtime,
      {projectId: 'p', sessionId: 's-inflight'},
      label => {
        upgrades.push(label);
      },
    );
    // 首帧估算档照常（gpt ≈）
    expect(first).toBe('gpt ≈ 30k / 128k (23%)');
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    // 升级不得启动：只有首帧那一次 resolve，也不进补跑槽（整串装配 + 原生
    // 计数与发送链共享 JS 线程与 SQLite 连接，正是把前奏拖到 11s 的竞争源）
    expect(upgrades).toEqual([]);
    expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledTimes(1);

    // run 结束后的刷新（真实链路：onSettled → transcript 变化触发）：门放开，
    // 升级照常补上
    runInFlight = false;
    const second = await loadChatPromptTokenLabelResilient(
      runtime,
      {projectId: 'p', sessionId: 's-inflight'},
      label => {
        upgrades.push(label);
      },
    );
    expect(second).toBe('gpt ≈ 30k / 128k (23%)');
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    expect(upgrades).toEqual(['glm = 99.3k / 128k (78%)']);
  });

  it('build 中途弃权（2026-09-30 回滚竞态）：shouldBail 命中返回空串哨兵，不走 fallback、不排升级轮', async () => {
    // 场景还原：回滚触发的刷新在 run 注册前起跑，build 途中 run 起步——
    // 分段 bail 抛弃权错误，读口须按「保留旧标签」收场（空串），绝不能
    // 落进 catch→fallback（那会再算一遍，恰是要避免的竞争）。
    mockBuildSessionPromptInput.mockImplementationOnce(() => {
      throw new ChatPromptBuildBailedError();
    });
    mockResolveSavedModelId.mockReturnValue('zai/glm-4.6');
    mockResolveTokenCounterModeForModel.mockResolvedValue('glm');

    const upgrades: string[] = [];
    const label = await loadChatPromptTokenLabelResilient(
      stubRuntime({contextWindow: 128_000}),
      {projectId: 'p', sessionId: 's-bail'},
      l => {
        upgrades.push(l);
      },
      {shouldBail: () => true},
    );

    expect(label).toBe('');
    // 弃权即止：resolve 与 fallback 计数都不发生，升级回调不触发。
    expect(mockResolvePromptTokensWithBackfill).not.toHaveBeenCalled();
    expect(mockCountTextWithDefaultEncoding).not.toHaveBeenCalled();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    expect(upgrades).toEqual([]);
  });

  it('build/resolve 边界弃权（r3-chip-1）：build 返回后翻真 → 空串哨兵，getSessionAgentConfig 未被调', async () => {
    // build 段的分段 bail 只管得到 build 段内部；最后一段 bail 到 resolve 派发
    // 之间还夹着 getSessionAgentConfig / resolveSavedModelId / 计数模式解析三次
    // IO，run 起步的窗口正落在这里——没有这道检查点就等于「进得去停不下」。
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {model: 'zai/glm-4.6'},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });

    let bailed = false;
    const runtime = stubRuntime({contextWindow: 128_000});
    const upgrades: string[] = [];
    const label = await loadChatPromptTokenLabelResilient(
      runtime,
      {projectId: 'p', sessionId: 's-boundary-bail'},
      l => {
        upgrades.push(l);
      },
      {
        // build 已返回后才翻真：build 自己那些分段检查点都放行了。
        shouldBail: () => {
          bailed = true;
          return true;
        },
      },
    );

    expect(bailed).toBe(true);
    expect(label).toBe('');
    expect(runtime.sessions.getSessionAgentConfig).not.toHaveBeenCalled();
    // 弃权即止：resolve 与 fallback 计数都不发生，后台升级轮不排。
    expect(mockResolvePromptTokensWithBackfill).not.toHaveBeenCalled();
    expect(mockCountTextWithDefaultEncoding).not.toHaveBeenCalled();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    expect(upgrades).toEqual([]);
  });

  it('resolve 段弃权错误不逃逸（r3-chip-1）：PromptTokenResolveBailedError → 空串哨兵，绝不走 fallback', async () => {
    // catch 只认 ChatPromptBuildBailedError 时，这个错误会一路逃到
    // startPreciseUpgrade 的 catch / 外层 rejection —— 表现为 unhandled
    // rejection，且首帧回落成「重算一遍」的 fallback（恰是要消灭的竞争）。
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {model: 'zai/glm-4.6'},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });
    mockResolveSavedModelId.mockReturnValue('zai/glm-4.6');
    mockResolveTokenCounterModeForModel.mockResolvedValue('glm');
    mockResolvePromptTokensWithBackfill.mockRejectedValue(
      new PromptTokenResolveBailedError(),
    );

    const runtime = stubRuntime({contextWindow: 128_000});
    (runtime.messages.listBySession as jest.Mock).mockResolvedValue([
      {
        role: 'user',
        content: {blocks: [{type: 'text', text: 'hello'}]},
        hidden: false,
      },
    ]);

    const upgrades: string[] = [];
    const label = await loadChatPromptTokenLabelResilient(
      runtime,
      {projectId: 'p', sessionId: 's-resolve-bail'},
      l => {
        upgrades.push(l);
      },
    );

    expect(label).toBe('');
    // fallback 的标志动作一个都没发生（listBySession 拉全量 + 折算计数）。
    expect(runtime.messages.listBySession).not.toHaveBeenCalled();
    expect(mockCountTextWithDefaultEncoding).not.toHaveBeenCalled();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    expect(upgrades).toEqual([]);
  });

  it('shouldBail 透传到 resolve 读口（r3-chip-1）：不在调用点时 options 不带该键', async () => {
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {model: 'openai/gpt-4o'},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });
    mockResolveSavedModelId.mockReturnValue('openai/gpt-4o');
    mockResolveTokenCounterModeForModel.mockResolvedValue('auto');
    mockResolvePromptTokensWithBackfill.mockResolvedValue({
      tokenCount: 24_000,
      estimated: false,
      counterKind: 'tiktoken',
      source: 'local',
    });

    // ① 传了 shouldBail → 透传到第 4 参（core 读口的弃权观察点由此生效）。
    const shouldBail = () => false;
    await loadChatPromptTokenLabelResilient(
      stubRuntime({contextWindow: 128_000}),
      {projectId: 'p', sessionId: 's-bail-passthrough'},
      undefined,
      {shouldBail},
    );
    expect(
      (mockResolvePromptTokensWithBackfill.mock.calls[0]![3] as {
        shouldBail?: () => boolean;
      }).shouldBail,
    ).toBe(shouldBail);

    // ② 不传 → options 里连这个键都不出现（core 缺省「恒不弃权」，
    // 既有调用面零影响，也别让快照式断言平白多一个 undefined 键）。
    mockResolvePromptTokensWithBackfill.mockClear();
    await loadChatPromptTokenLabel(stubRuntime(), {
      projectId: 'p',
      sessionId: 's-bail-absent',
    });
    expect(mockResolvePromptTokensWithBackfill.mock.calls[0]![3]).toEqual({
      sessionKkv: expect.objectContaining({get: expect.any(Function)}),
    });
  });

  it('压缩预热（消跳变）：warm 在途时冻结标志为真、走完整解析；结束/失败均清标志', async () => {
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {model: 'zai/glm-4.6'},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });
    mockResolveSavedModelId.mockReturnValue('zai/glm-4.6');
    mockResolveTokenCounterModeForModel.mockResolvedValue('glm');

    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    mockResolvePromptTokensWithBackfill.mockImplementation(
      async () =>
        await gate.then(() => ({
          tokenCount: 99_300,
          estimated: false,
          counterKind: 'glm',
          source: 'local',
        })),
    );

    const runtime = stubRuntime({contextWindow: 128_000});
    const warm = warmChatTokenLabelAfterCompaction(runtime, {
      projectId: 'p',
      sessionId: 's-warm',
    });
    await new Promise(resolve => setImmediate(resolve));
    // warm 在途：chip 冻结标志生效（hook 层据此跳过刷新）
    expect(isChatTokenPreciseWarmInflight('s-warm')).toBe(true);
    expect(isChatTokenPreciseWarmInflight('s-other')).toBe(false);

    release();
    await warm;
    expect(isChatTokenPreciseWarmInflight('s-warm')).toBe(false);
    // warm 走完整解析（不带 preferEstimate——首帧即精确档的预热本体）
    const opts = mockResolvePromptTokensWithBackfill.mock.calls[0]![3] as {
      preferEstimate?: boolean;
    };
    expect(opts?.preferEstimate).toBeUndefined();
  });

  it('压缩预热：解析失败静默吞错（压缩流程不受影响）且标志必清', async () => {
    mockBuildSessionPromptInput.mockRejectedValue(new Error('build boom'));
    const runtime = stubRuntime({contextWindow: 128_000});
    await expect(
      warmChatTokenLabelAfterCompaction(runtime, {
        projectId: 'p',
        sessionId: 's-warm-fail',
      }),
    ).resolves.toBeUndefined();
    expect(isChatTokenPreciseWarmInflight('s-warm-fail')).toBe(false);
  });

  it('两阶段：api 命中即精确，不触发后台升级', async () => {
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {model: 'openai/gpt-4o'},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });
    mockResolveSavedModelId.mockReturnValue('openai/gpt-4o');
    mockResolveTokenCounterModeForModel.mockResolvedValue('auto');
    mockResolvePromptTokensWithBackfill.mockResolvedValue({
      tokenCount: 50_000,
      estimated: false,
      counterKind: 'api',
      source: 'api',
    });

    const runtime = stubRuntime({contextWindow: 128_000});
    const upgrades: string[] = [];
    const label = await loadChatPromptTokenLabelResilient(
      runtime,
      {projectId: 'p', sessionId: 's-two-phase-api'},
      l => {
        upgrades.push(l);
      },
    );
    expect(label).toBe('远程 = 50k / 128k (39%)');
    await new Promise(resolve => setImmediate(resolve));
    expect(upgrades).toEqual([]);
    expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledTimes(1);
  });

  /** 两阶段用例的公共 mock：首帧估算、完整口径按 fabricate 产出。 */
  function mockTwoPhaseResolve(
    fabricate: () => Promise<{
      tokenCount: number;
      estimated: boolean;
      counterKind: string;
      source: 'local';
    }>
  ): void {
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {model: 'zai/glm-4.6'},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });
    mockResolveSavedModelId.mockReturnValue('zai/glm-4.6');
    mockResolveTokenCounterModeForModel.mockResolvedValue('glm');
    mockResolvePromptTokensWithBackfill.mockImplementation(
      (_sid: string, _raw: unknown, _params: unknown, options?: unknown) => {
        const preferEstimate = (
          options as {preferEstimate?: boolean} | undefined
        )?.preferEstimate;
        if (preferEstimate === true) {
          return Promise.resolve({
            tokenCount: 30_000,
            estimated: true,
            counterKind: 'heuristic',
            source: 'local',
          });
        }
        return fabricate();
      },
    );
  }

  it('两阶段边界①：升级在途时的刷新不并发堆叠，但落定后按最新首帧补跑一轮', async () => {
    const releaseQueue: Array<() => void> = [];
    mockTwoPhaseResolve(
      () =>
        new Promise(resolve => {
          releaseQueue.push(() =>
            resolve({
              tokenCount: 99_300,
              estimated: false,
              counterKind: 'glm',
              source: 'local',
            }),
          );
        }),
    );

    const runtime = stubRuntime({contextWindow: 128_000});
    const upgrades: string[] = [];
    await loadChatPromptTokenLabelResilient(
      runtime,
      {projectId: 'p', sessionId: 's-inflight'},
      l => upgrades.push(l),
    );
    // 升级在途（第一轮尚未放行）时再次刷新：首帧照出估算，后台轮被 inflight
    // 去重——此时 3 次 resolve（两首帧 + 一轮升级），不堆叠并发计数。
    const second = await loadChatPromptTokenLabelResilient(
      runtime,
      {projectId: 'p', sessionId: 's-inflight'},
      l => upgrades.push(l),
    );
    expect(second).toBe('gpt ≈ 30k / 128k (23%)');
    expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledTimes(3);

    // 放行第一轮：第二次刷新已推进新鲜度代数 → 陈旧结果被闸丢弃（不回调）。
    releaseQueue[0]!();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    expect(upgrades).toEqual([]);
    // 但丢弃不是终点：补跑槽里排着第二次刷新的升级请求，立刻按它重跑一轮
    // （第 4 次 resolve）——这正是「手动压缩后 chip 永停 gpt ≈」的修复点。
    expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledTimes(4);

    releaseQueue[1]!();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    expect(upgrades).toEqual(['glm = 99.3k / 128k (78%)']);
  });

  it('两阶段边界④：在途期间连发多次刷新只补跑最新一次（补跑槽覆盖，不堆叠）', async () => {
    const releaseQueue: Array<() => void> = [];
    mockTwoPhaseResolve(
      () =>
        new Promise(resolve => {
          releaseQueue.push(() =>
            resolve({
              tokenCount: 99_300,
              estimated: false,
              counterKind: 'glm',
              source: 'local',
            }),
          );
        }),
    );

    const runtime = stubRuntime({contextWindow: 128_000});
    const upgrades: string[] = [];
    for (let i = 0; i < 3; i++) {
      await loadChatPromptTokenLabelResilient(
        runtime,
        {projectId: 'p', sessionId: 's-coalesce'},
        l => upgrades.push(l),
      );
    }
    // 3 次首帧 + 1 轮在途 = 4 次 resolve（后两次刷新只排队、不各起一轮）。
    expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledTimes(4);

    releaseQueue[0]!();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    // 在途轮被闸丢弃；补跑只有一轮（最新一次请求），不是两轮。
    expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledTimes(5);
    releaseQueue[1]!();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    expect(upgrades).toEqual(['glm = 99.3k / 128k (78%)']);
  });

  it('两阶段边界②：后台轮失败无回调、inflight 释放后下次刷新可再次启动升级', async () => {
    let upgradeAttempts = 0;
    mockTwoPhaseResolve(() => {
      upgradeAttempts += 1;
      if (upgradeAttempts === 1) {
        return Promise.reject(new Error('count-boom'));
      }
      return Promise.resolve({
        tokenCount: 99_300,
        estimated: false,
        counterKind: 'glm',
        source: 'local',
      });
    });

    const runtime = stubRuntime({contextWindow: 128_000});
    const upgrades: string[] = [];
    // 第一次升级 reject：保持首帧估算标签、无回调。
    await loadChatPromptTokenLabelResilient(
      runtime,
      {projectId: 'p', sessionId: 's-retry'},
      l => upgrades.push(l),
    );
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    expect(upgrades).toEqual([]);

    // inflight 已释放：下一次刷新重新启动升级（第二次不 reject）→ 回调到位。
    await loadChatPromptTokenLabelResilient(
      runtime,
      {projectId: 'p', sessionId: 's-retry'},
      l => upgrades.push(l),
    );
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    expect(upgrades).toEqual(['glm = 99.3k / 128k (78%)']);
    expect(upgradeAttempts).toBe(2);
  });

  it('两阶段边界③（B-1 场景②）：升级在途切模型 → 旧家族精确标签被新鲜度闸丢弃，补跑轮按新模型到位', async () => {
    // 同会话切模型：model A（glm）升在途，切到 model B（tiktoken）后 A 的
    // 精确标签不得落 UI（否则 chip 长期显示旧家族记号）。
    let family: 'glm' | 'tiktoken' = 'glm';
    const releaseQueue: Array<() => void> = [];
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {model: 'switchable'},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });
    mockResolveSavedModelId.mockImplementation(() =>
      family === 'glm' ? 'zai/glm-4.6' : 'openai/gpt-4o',
    );
    mockResolveTokenCounterModeForModel.mockImplementation(() =>
      Promise.resolve(family),
    );
    mockResolvePromptTokensWithBackfill.mockImplementation(
      (_sid: string, _raw: unknown, _params: unknown, options?: unknown) => {
        const preferEstimate = (
          options as {preferEstimate?: boolean} | undefined
        )?.preferEstimate;
        if (preferEstimate === true) {
          return Promise.resolve({
            tokenCount: 30_000,
            estimated: true,
            counterKind: 'heuristic',
            source: 'local',
          });
        }
        const familyAtCall = family;
        return new Promise(resolve => {
          releaseQueue.push(() =>
            resolve(
              familyAtCall === 'glm'
                ? {
                    tokenCount: 99_300,
                    estimated: false,
                    counterKind: 'glm',
                    source: 'local',
                  }
                : {
                    tokenCount: 24_000,
                    estimated: false,
                    counterKind: 'tiktoken',
                    source: 'local',
                  },
            ),
          );
        });
      },
    );

    const runtime = stubRuntime({contextWindow: 128_000});
    const upgrades: string[] = [];
    // ① model A 首帧 + 升级在途。
    await loadChatPromptTokenLabelResilient(
      runtime,
      {projectId: 'p', sessionId: 's-switch-model'},
      l => upgrades.push(l),
    );
    // ② 切到 model B 并刷新：新首帧（推进新鲜度代数）；B 的升级请求进补跑槽。
    family = 'tiktoken';
    const afterSwitch = await loadChatPromptTokenLabelResilient(
      runtime,
      {projectId: 'p', sessionId: 's-switch-model'},
      l => upgrades.push(l),
    );
    expect(afterSwitch).toBe('gpt ≈ 30k / 128k (23%)');
    // ③ 放行 A 的升级：gen 已变 → 丢弃，不回调旧家族标签；补跑轮随即起步
    //    （按补跑槽里的 B 请求重跑，模型解析发生在重跑起步时 → 取到 B）。
    releaseQueue[0]!();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    expect(upgrades).toEqual([]);
    expect(releaseQueue.length).toBe(2);
    // ④ 放行补跑轮：它是 B 的计数，gen 未再推进 → 到位的是 B 的家族标签。
    releaseQueue[1]!();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    expect(upgrades).toEqual(['gpt = 24k / 128k (19%)']);
  });
});
