import {formatPromptTokenUsageLabel} from '@novel-master/core/common';
import {formatCounterKindLabel} from '@novel-master/core/provider';
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

jest.mock('@novel-master/core/provider', () => ({
  resolvePromptTokensWithBackfill: (...args: unknown[]) =>
    mockResolvePromptTokensWithBackfill(...args),
  resolveTokenCounterModeForModel: (...args: unknown[]) =>
    mockResolveTokenCounterModeForModel(...args),
  serializePromptLlmInput: (...args: unknown[]) =>
    mockSerializePromptLlmInput(...args),
  formatTokenSourceLabel: (source: string) =>
    source === 'api' ? '上次请求' : '预估',
  formatCounterKindLabel: (kind: string) =>
    kind === 'api' || kind === 'heuristic' ? '自动' : kind,
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

  it('formatPromptTokenUsageLabel shows percentage with context window', () => {
    expect(formatPromptTokenUsageLabel(64000, 128000)).toBe('50% • 64K/128K');
  });

  it('formatPromptTokenUsageLabel marks estimated fallback', () => {
    expect(
      formatPromptTokenUsageLabel(1000, undefined, {estimated: true}),
    ).toBe('~1K tokens (est.)');
  });

  it('loadChatPromptTokenLabel appends local-source suffix (预估)', async () => {
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

    expect(label).toBe('19% • 24K/128K · 预估');
    expect(mockResolvePromptTokensWithBackfill).toHaveBeenCalledWith(
      's1',
      // rawMessages 已无实际用途（回填废弃），仅签名兼容保留；mock bundle 不携带时为 undefined
      undefined,
      expect.objectContaining({tokenizerOverride: 'gemma'}),
      // 第 4 参透传 sessionKkv：读口据此取跨重启的 API 值
      {sessionKkv: runtime.sessionKkv},
    );
  });

  it('T-T9: source===api ⇒ 标签「上次请求」且无估算前缀', async () => {
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

    expect(label).toBe('19% • 24K/128K · 上次请求');
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

  it('无模型早退：改走 cl100k 真计数，不再走 heuristic.countText', async () => {
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
    expect(label).toBe('~2.3K tokens (est.) · 预估');
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
    expect(label).toBe('~2.3K tokens (est.) · 预估');
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
    expect(label).toBe('~1K tokens (est.) · 预估');
  });

  it('T-S7: formatCounterKindLabel maps api/heuristic to 自动', () => {
    expect(formatCounterKindLabel('api')).toBe('自动');
    expect(formatCounterKindLabel('heuristic')).toBe('自动');
    expect(formatCounterKindLabel('tiktoken')).toBe('tiktoken');
  });
});
