import {
  formatContextUsageLabel,
  formatTokenSourceBadge,
} from '@novel-master/core/common';
import {
  loadChatPromptTokenLabel,
  loadChatPromptTokenLabelResilient,
} from '@/services/chat-prompt-tokens.service';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

const mockResolvePromptTokensWithBackfill = jest.fn();
const mockResolveTokenCounterModeForModel = jest.fn();
const mockBuildSessionPromptInput = jest.fn();
const mockResolveSavedModelId = jest.fn();
const mockSerializePromptLlmInput = jest.fn(() => 'serialized');
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
jest.mock('@novel-master/core/provider', () => ({
  resolvePromptTokensWithBackfill: (...args: unknown[]) =>
    mockResolvePromptTokensWithBackfill(...args),
  resolveTokenCounterModeForModel: (...args: unknown[]) =>
    mockResolveTokenCounterModeForModel(...args),
  serializePromptLlmInput: (...args: unknown[]) =>
    mockSerializePromptLlmInput(...args),
}));

jest.mock('@novel-master/core/agent', () => ({
  resolveSavedModelId: (...args: unknown[]) => mockResolveSavedModelId(...args),
}));

jest.mock('@novel-master/core/prompt', () => ({
  messageBodyText: () => 'hello',
}));

jest.mock('@/services/session-prompt-input.service', () => ({
  buildSessionPromptInput: (...args: unknown[]) =>
    mockBuildSessionPromptInput(...args),
}));

function stubRuntime(overrides?: {
  tokenCounterMode?: string;
  contextWindow?: number | null;
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
});
