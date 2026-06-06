import {formatPromptTokenUsageLabel} from '../src/utils/format-token-count';
import {loadChatPromptTokenLabel} from '../src/services/chat-prompt-tokens.service';
import type {MobileNovelMasterRuntime} from '../src/runtime/types';

const mockCountPromptLlmInput = jest.fn();
const mockResolveTokenCounterModeForModel = jest.fn();
const mockBuildSessionPromptInput = jest.fn();
const mockResolveApplicationModelId = jest.fn();

jest.mock('@novel-master/core', () => {
  const actual = jest.requireActual('@novel-master/core');
  return {
    ...actual,
    countPromptLlmInput: (...args: unknown[]) => mockCountPromptLlmInput(...args),
    resolveTokenCounterModeForModel: (...args: unknown[]) =>
      mockResolveTokenCounterModeForModel(...args),
    resolveApplicationModelId: (...args: unknown[]) =>
      mockResolveApplicationModelId(...args),
    serializePromptLlmInput: () => 'serialized',
  };
});

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
    mockCountPromptLlmInput.mockReset();
    mockResolveTokenCounterModeForModel.mockReset();
    mockBuildSessionPromptInput.mockReset();
    mockResolveApplicationModelId.mockReset();
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
      blocks: [],
      ctx: {worktreeDisplay: '', filetreeDisplay: '', messages: []},
    });
    mockResolveApplicationModelId.mockReturnValue('openai/gpt-4o');
    mockResolveTokenCounterModeForModel.mockResolvedValue('gemma');
    mockCountPromptLlmInput.mockResolvedValue({
      tokenCount: 24_000,
      estimated: false,
      counterKind: 'gemma',
    });

    const label = await loadChatPromptTokenLabel(stubRuntime(), {
      sessionId: 's1',
      projectId: 'p1',
    });

    expect(label).toBe('19% • 24K/128K · gemma');
    expect(mockCountPromptLlmInput).toHaveBeenCalledWith(
      expect.objectContaining({tokenizerOverride: 'gemma'}),
    );
  });

  it('loadChatPromptTokenLabel without model uses heuristic suffix', async () => {
    mockBuildSessionPromptInput.mockResolvedValue({
      definition: {},
      blocks: [],
      ctx: {worktreeDisplay: '', filetreeDisplay: '', messages: []},
    });
    mockResolveApplicationModelId.mockReturnValue(undefined);

    const label = await loadChatPromptTokenLabel(stubRuntime(), {
      sessionId: 's1',
      projectId: 'p1',
    });

    expect(label).toBe('~1K tokens (est.) · heuristic');
  });
});
