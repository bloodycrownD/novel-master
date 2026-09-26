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

jest.mock('@novel-master/tokenizer-driver-rn/android-native-bridge', () => {
  const actual = jest.requireActual(
    '@novel-master/tokenizer-driver-rn/android-native-bridge',
  );
  return {
    ...actual,
    isNativeTokenizerAvailable: () => nativeBridgeState.available,
    countPromptViaNative: jest.fn(
      async (req: {
        serialized: string;
        family: string;
        vendorModelId: string;
      }) => {
        if (!nativeBridgeState.available) {
          return null;
        }
        const result = await mockCountPrompt(
          req.serialized,
          req.family,
          req.vendorModelId,
        );
        return result;
      },
    ),
  };
});

jest.mock('@novel-master/core', () => ({
  CHARACTERS_PER_TOKEN_RATIO: 3.35,
  parseApplicationModelId: (id: string) => ({
    vendorModelId: id.split('/').pop() ?? id,
  }),
  resolveTokenizerFamily: () => mockResolveFamily,
  mapVendorModelIdToTiktokenModel: () => 'gpt-4o',
  serializePromptLlmInput: () => '',
}));

const mockEncodingForModel = jest.fn(() => ({
  encode: () => [1, 2, 3],
  free: () => {},
}));

jest.mock('tiktoken', () => ({
  encoding_for_model: (...args: unknown[]) => mockEncodingForModel(...args),
}));

// 兜底路径（原生不可用 / family=heuristic / 未知家族）现在走驱动自己的 cl100k
// 编码表，而不是 app 侧或 driver 侧的字符折算。这里给一份**真 ranks**：
// 「原生不可用时的读数到底有多大」正是本次改造要钉住的东西，用真表才量得出
// 「远大于折算」这个差距（用 mock 假表量出来的倍数没有意义）。
const {Tiktoken} = require('js-tiktoken/lite');
const cl100kRanksModule = require('js-tiktoken/ranks/cl100k_base');
const realCl100k = new Tiktoken(cl100kRanksModule.default ?? cl100kRanksModule);
const cl100kCount = (text: string): number => realCl100k.encode(text).length;

/** 中文正文（100 字符；折算会低估约 2 倍）。 */
const ZH_TEXT =
  '夜色如水，林间小径上落满了枯叶，风一吹便沙沙作响。她停下脚步，抬头望向灯火。';

describe('tokenizer-driver-rn countPromptLlmInputRn', () => {
  beforeEach(() => {
    mockCountPrompt.mockReset();
    mockEncodingForModel.mockClear();
    nativeBridgeState.available = true;
    mockResolveFamily = 'claude';
  });

  afterEach(() => {
    // 编码表单例是模块级缓存：故障注入用例改了构造器，必须还原，
    // 否则会把「构造失败不再重试」的 null 缓存漏给后续用例。
    const {
      __resetRnEncodingCacheForTests,
      __setRnEncodingFactoryForTests,
    } = require('@novel-master/tokenizer-driver-rn');
    __setRnEncodingFactoryForTests(null);
    __resetRnEncodingCacheForTests();
  });

  it('calls native bridge for claude family', async () => {
    mockCountPrompt.mockResolvedValue({
      tokenCount: 42,
      counterKind: 'claude',
      estimated: false,
    });
    const {__test__} = require('@novel-master/tokenizer-driver-rn');

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
    const {__test__} = require('@novel-master/tokenizer-driver-rn');

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

  it('uses js-tiktoken encoding_for_model for tiktoken family', async () => {
    mockResolveFamily = 'tiktoken';
    const {__test__} = require('@novel-master/tokenizer-driver-rn');
    __test__.setTiktokenModuleForTests(require('tiktoken'));

    const result = await __test__.countSerialized(
      'tiktoken',
      'system prompt for gpt',
      'openai/gpt-4o',
    );

    expect(mockEncodingForModel).toHaveBeenCalledWith('gpt-4o');
    expect(mockCountPrompt).not.toHaveBeenCalled();
    // cr-fix-spec D1-06 整改：RN 的 js-tiktoken 包装粒度比 Node precise 档粗，
    // counterKind 诚实标 heuristic，不能冒充精确 tiktoken（否则 compaction 按精确阈值判定易超限）。
    expect(result).toEqual({
      count: 9,
      counterKind: 'heuristic',
      estimated: true,
    });
  });

  it('原生不可用时改走 cl100k 真分词器（不再折算），counterKind 诚实标 heuristic', async () => {
    nativeBridgeState.available = false;
    const {__test__} = require('@novel-master/tokenizer-driver-rn');

    const result = await __test__.countSerialized(
      'claude',
      'abcdefghij',
      'claude-3-5-sonnet',
    );

    expect(mockCountPrompt).not.toHaveBeenCalled();
    expect(result).toEqual({
      count: cl100kCount('abcdefghij'),
      counterKind: 'heuristic',
      estimated: true,
    });
    // counterKind 报家族名 = 让压缩阈值以为这是 claude 真 tokenizer 的读数而不
    // 乘 0.85 安全系数；实际跑的是 cl100k 近似，必须标 heuristic。
    expect(result.counterKind).not.toBe('claude');
  });

  it('对照：原生不可用时中文读数远大于字符折算（钉住本次改造真的生效）', async () => {
    nativeBridgeState.available = false;
    const {__test__} = require('@novel-master/tokenizer-driver-rn');

    const result = await __test__.countSerialized(
      'claude',
      ZH_TEXT,
      'claude-3-5-sonnet',
    );

    const fold = Math.ceil(ZH_TEXT.length / 3.35);
    // 折算对中文低估 82%~84%：cl100k 约 1.64 token/字符（≈0.61 字符/token），
    // 真值应是折算的 2 倍上下。1.5× 是保守下界，真值若与折算持平就说明改造
    // 没生效。
    expect(result.count).toBeGreaterThan(fold * 1.5);
    expect(result.count).toBe(cl100kCount(ZH_TEXT));
    expect(result.counterKind).toBe('heuristic');
    expect(result.estimated).toBe(true);
  });

  it('family=heuristic 与未知家族也走 cl100k 真计数（无折算落点）', async () => {
    const {__test__} = require('@novel-master/tokenizer-driver-rn');

    const heuristicFamily = await __test__.countSerialized(
      'heuristic',
      ZH_TEXT,
      'local/any',
    );
    const unknownFamily = await __test__.countSerialized(
      'brand-new-family' as never,
      ZH_TEXT,
      'vendor/whatever',
    );

    expect(heuristicFamily).toEqual({
      count: cl100kCount(ZH_TEXT),
      counterKind: 'heuristic',
      estimated: true,
    });
    expect(unknownFamily).toEqual(heuristicFamily);
  });

  it('编码表建不起来时降级到字符折算，且失败不重试（缓存 null）', async () => {
    const {
      __test__,
      __setRnEncodingFactoryForTests,
      __resetRnEncodingCacheForTests,
    } = require('@novel-master/tokenizer-driver-rn');
    let attempts = 0;
    __setRnEncodingFactoryForTests(() => {
      attempts += 1;
      throw new Error('ranks unavailable');
    });
    __resetRnEncodingCacheForTests();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const first = await __test__.countSerialized(
        'claude',
        'abcdefghij',
        'claude-3-5-sonnet',
      );
      const second = await __test__.countSerialized(
        'claude',
        'abcdefghij',
        'claude-3-5-sonnet',
      );

      const fold = Math.ceil(10 / 3.35);
      expect(first).toEqual({
        count: fold,
        counterKind: 'heuristic',
        estimated: true,
      });
      expect(second).toEqual(first);
      // 「构造失败缓存 null 且不重试」是刻意的降级：同进程内反复重试同一条
      // 必然失败的构造只是白烧 CPU。若这条红了，说明失败被重试了。
      expect(attempts).toBe(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('propagates native estimated:true on failure path', async () => {
    mockCountPrompt.mockResolvedValue({
      tokenCount: 12,
      counterKind: 'gemma',
      estimated: true,
    });
    mockResolveFamily = 'gemma';
    const {__test__} = require('@novel-master/tokenizer-driver-rn');

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

  it('字符折算仅剩最后一降级：3.35 口径本身不变（编码表建不起来时才用）', () => {
    const {__test__} = require('@novel-master/tokenizer-driver-rn');
    expect(__test__.heuristicCount('abcdefghij')).toBe(Math.ceil(10 / 3.35));
  });

  it('tools 段计入计数：非空变大，空数组与缺省一致', async () => {
    const {countPromptLlmInputRn} = require('@novel-master/tokenizer-driver-rn');
    const registry = {
      heuristic: {countText: (text: string) => Math.ceil(text.length / 3.35)},
      getTokenizerOverride: async () => 'heuristic',
    };
    const base = {
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
      savedModelId: 'local/any',
      registry,
      tokenizerOverride: 'heuristic',
    };

    const withoutTools = await countPromptLlmInputRn(base);
    const withTools = await countPromptLlmInputRn({
      ...base,
      tools: [
        {
          name: 'read_file',
          description: '读取工作区里的一个文件并返回正文。',
          inputSchema: {type: 'object', properties: {path: {type: 'string'}}},
        },
      ],
    });
    const withEmptyTools = await countPromptLlmInputRn({...base, tools: []});

    expect(withTools.tokenCount).toBeGreaterThan(withoutTools.tokenCount);
    expect(withEmptyTools.tokenCount).toBe(withoutTools.tokenCount);
    expect(withTools.counterKind).toBe('heuristic');
  });
});
