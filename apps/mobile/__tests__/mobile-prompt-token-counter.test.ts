const mockCountPrompt = jest.fn();

const nativeBridgeState = {
  available: true,
};

let mockResolveFamily = 'claude';

jest.mock('react-native', () => ({
  Platform: {OS: 'android'},
  NativeModules: {
    NovelMasterTokenizer: {
      countPrompt: (...args: unknown[]) => mockCountPrompt(...args),
    },
  },
}));

jest.mock('../src/tokenizer/native-tokenizer', () => {
  const actual = jest.requireActual('../src/tokenizer/native-tokenizer');
  return {
    ...actual,
    isNativeTokenizerAvailable: () => nativeBridgeState.available,
    countPromptViaNative: jest.fn(
      async (req: {serialized: string; family: string; vendorModelId: string}) => {
        if (!nativeBridgeState.available) {
          return null;
        }
        const result = await mockCountPrompt(req.serialized, req.family, req.vendorModelId);
        return result;
      },
    ),
  };
});

jest.mock('@novel-master/core', () => ({
  CHARACTERS_PER_TOKEN_RATIO: 3.35,
  NM_PROMPT_TOKEN_COUNTER_KEY: '__NM_PROMPT_TOKEN_COUNTER__',
  parseApplicationModelId: (id: string) => ({vendorModelId: id.split('/').pop() ?? id}),
  resolveTokenizerFamily: () => mockResolveFamily,
  mapVendorModelIdToTiktokenModel: () => 'gpt-4o',
  serializePromptLlmInput: () => '',
}));

jest.mock('tiktoken', () => ({
  encoding_for_model: () => ({
    encode: () => [1, 2, 3],
    free: () => {},
  }),
}));

describe('mobile-prompt-token-counter', () => {
  beforeEach(() => {
    mockCountPrompt.mockReset();
    nativeBridgeState.available = true;
    mockResolveFamily = 'claude';
  });

  it('calls native bridge for claude family', async () => {
    mockCountPrompt.mockResolvedValue({
      tokenCount: 42,
      counterKind: 'claude',
      estimated: false,
    });
    const {__test__} = require('../src/tokenizer/mobile-prompt-token-counter');

    const result = await __test__.countSerialized(
      'claude',
      'system prompt body',
      'anthropic/claude-3-5-sonnet',
    );

    expect(mockCountPrompt).toHaveBeenCalledWith(
      'system prompt body',
      'claude',
      'anthropic/claude-3-5-sonnet',
    );
    expect(result).toEqual({
      count: 42,
      counterKind: 'claude',
      estimated: false,
    });
  });

  it('calls native bridge for gemma family (gemini model id)', async () => {
    mockResolveFamily = 'gemma';
    mockCountPrompt.mockResolvedValue({
      tokenCount: 8,
      counterKind: 'gemma',
      estimated: false,
    });
    const {__test__} = require('../src/tokenizer/mobile-prompt-token-counter');

    const result = await __test__.countSerialized(
      'gemma',
      'You are helpful.\n\nuser: Hello',
      'gemini-2.0-flash',
    );

    expect(mockCountPrompt).toHaveBeenCalledWith(
      'You are helpful.\n\nuser: Hello',
      'gemma',
      'gemini-2.0-flash',
    );
    expect(result.estimated).toBe(false);
    expect(result.count).toBeGreaterThan(0);
  });

  it('falls back to heuristic when native bridge is unavailable', async () => {
    nativeBridgeState.available = false;
    const {__test__} = require('../src/tokenizer/mobile-prompt-token-counter');

    const result = await __test__.countSerialized(
      'claude',
      'abcdefghij',
      'claude-3-5-sonnet',
    );

    expect(mockCountPrompt).not.toHaveBeenCalled();
    expect(result).toEqual({
      count: Math.ceil(10 / 3.35),
      counterKind: 'claude',
      estimated: true,
    });
  });

  it('propagates native estimated:true on failure path', async () => {
    mockCountPrompt.mockResolvedValue({
      tokenCount: 12,
      counterKind: 'gemma',
      estimated: true,
    });
    mockResolveFamily = 'gemma';
    const {__test__} = require('../src/tokenizer/mobile-prompt-token-counter');

    const result = await __test__.countSerialized(
      'gemma',
      'short prompt',
      'gemini-2.0-flash',
    );

    expect(result).toEqual({
      count: 12,
      counterKind: 'gemma',
      estimated: true,
    });
  });

  it('heuristic uses 3.35 character ratio', () => {
    const {__test__} = require('../src/tokenizer/mobile-prompt-token-counter');
    expect(__test__.heuristicCount('abcdefghij')).toBe(Math.ceil(10 / 3.35));
  });
});
