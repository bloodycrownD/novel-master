import {formatPromptTokenUsageLabel} from '../src/utils/format-token-count';
import {
  loadChatPromptTokenLabel,
  loadChatPromptTokenLabelResilient,
} from '../src/services/chat-prompt-tokens.service';
import type {MobileNovelMasterRuntime} from '../src/runtime/types';

const mockResolveCurrentPromptTokens = jest.fn();
const mockResolveTokenCounterModeForModel = jest.fn();
const mockBuildSessionPromptInput = jest.fn();
const mockResolveApplicationModelId = jest.fn();
const mockSerializePromptLlmInput = jest.fn(() => 'serialized');

jest.mock('@novel-master/core/provider', () => ({
  resolveCurrentPromptTokens: (...args: unknown[]) =>
    mockResolveCurrentPromptTokens(...args),
  resolveTokenCounterModeForModel: (...args: unknown[]) =>
    mockResolveTokenCounterModeForModel(...args),
  serializePromptLlmInput: (...args: unknown[]) =>
    mockSerializePromptLlmInput(...args),
}));

jest.mock('@novel-master/core/agent', () => ({
  resolveApplicationModelId: (...args: unknown[]) =>
    mockResolveApplicationModelId(...args),
}));

jest.mock('@novel-master/core/prompt', () => ({
  messageBodyText: () => 'hello',
}));

jest.mock('../src/services/session-prompt-input.service', () => ({
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
    messages: {listBySession: jest.fn()},
  } as unknown as MobileNovelMasterRuntime;
}

describe('chat-prompt-tokens.service', () => {
  beforeEach(() => {
    mockResolveCurrentPromptTokens.mockReset();
    mockResolveTokenCounterModeForModel.mockReset();
    mockBuildSessionPromptInput.mockReset();
    mockResolveApplicationModelId.mockReset();
    mockSerializePromptLlmInput.mockClear();
  });

  it('formatPromptTokenUsageLabel shows percentage with context window', () => {
    expect(formatPromptTokenUsageLabel(64000, 128000)).toBe('50% • 64K/128K');
  });

  it('formatPromptTokenUsageLabel marks estimated fallback', () => {
    expect(formatPromptTokenUsageLabel(1000, undefined, {estimated: true})).toBe(
      '~1K tokens (est.)',
    );
  });

  it('loadChatPromptTokenLabel appends counterKind suffix', async () => {
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {model: 'openai/gpt-4o'},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });
    mockResolveApplicationModelId.mockReturnValue('openai/gpt-4o');
    mockResolveTokenCounterModeForModel.mockResolvedValue('gemma');
    mockResolveCurrentPromptTokens.mockResolvedValue({
      tokenCount: 24_000,
      estimated: false,
      counterKind: 'gemma',
      source: 'local',
    });

    const label = await loadChatPromptTokenLabel(stubRuntime(), {
      sessionId: 's1',
      projectId: 'p1',
    });

    expect(label).toBe('19% • 24K/128K · gemma');
    expect(mockResolveCurrentPromptTokens).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({tokenizerOverride: 'gemma'}),
    );
  });

  it('T-T9: source===api ⇒ label 后缀 api 且无估算前缀', async () => {
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {model: 'openai/gpt-4o'},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });
    mockResolveApplicationModelId.mockReturnValue('openai/gpt-4o');
    mockResolveTokenCounterModeForModel.mockResolvedValue('auto');
    mockResolveCurrentPromptTokens.mockResolvedValue({
      tokenCount: 24_000,
      estimated: false,
      counterKind: 'api',
      source: 'api',
    });

    const label = await loadChatPromptTokenLabel(stubRuntime(), {
      sessionId: 's1',
      projectId: 'p1',
    });

    expect(label).toBe('19% • 24K/128K · api');
  });

  it('loadChatPromptTokenLabel without model uses heuristic suffix', async () => {
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {},
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
    });
    mockResolveApplicationModelId.mockReturnValue(undefined);

    const label = await loadChatPromptTokenLabel(stubRuntime(), {
      sessionId: 's1',
      projectId: 'p1',
    });

    expect(label).toBe('~1K tokens (est.) · heuristic');
  });

  it('T7: loadChatPromptTokenLabelResilient falls back to heuristic suffix on build error', async () => {
    mockBuildSessionPromptInput.mockRejectedValue(new Error('prompt build failed'));
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

    expect(label).toBe('~1K tokens (est.) · heuristic');
  });
});
