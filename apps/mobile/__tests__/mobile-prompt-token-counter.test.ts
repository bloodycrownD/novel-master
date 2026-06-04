const mockCountPrompt = jest.fn();

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
    isNativeTokenizerAvailable: () => true,
    countPromptViaNative: jest.fn(
      async (req: {serialized: string; family: string; vendorModelId: string}) => {
        const result = await mockCountPrompt(req.serialized, req.family, req.vendorModelId);
        return result;
      },
    ),
  };
});

jest.mock('@novel-master/core', () => ({
  CHARACTERS_PER_TOKEN_RATIO: 3.35,
  NM_PROMPT_TOKEN_COUNTER_KEY: '__NM_PROMPT_TOKEN_COUNTER__',
  parseApplicationModelId: (id: string) => ({vendorModelId: id}),
  resolveTokenizerFamily: () => 'claude',
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

  it('heuristic uses 3.35 character ratio', () => {
    const {__test__} = require('../src/tokenizer/mobile-prompt-token-counter');
    expect(__test__.heuristicCount('abcdefghij')).toBe(Math.ceil(10 / 3.35));
  });
});
