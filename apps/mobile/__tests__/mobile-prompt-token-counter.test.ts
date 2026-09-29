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
    // countPromptViaNative 用**真实实现**：Kotlin 契约变更（fa Step 4）后原生
    // 失败一律 promise.reject，本文件靠真实桥现成的 catch→null 分支承接
    // reject、断言 JS 侧兜底路径；底层调用经 react-native mock 落到
    // mockCountPrompt（三参同序，与既有断言兼容）。
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
    nativeBridgeState.available = true;
    mockResolveFamily = 'claude';
  });

  afterEach(() => {
    // 编码表单例是模块级缓存：故障注入用例改了构造器，必须还原，
    // 否则会把「构造失败不再重试」的 null 缓存漏给后续用例。
    const {
      __test__,
      __resetRnEncodingCacheForTests,
      __setRnEncodingFactoryForTests,
    } = require('@novel-master/tokenizer-driver-rn');
    __setRnEncodingFactoryForTests(null);
    __resetRnEncodingCacheForTests();
    // countTiktoken 的表源注入钩子同样要还原（表源注入用例用过它）。
    __test__.setEncodingSourceForTests(null);
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

  it('GPT 家族 o200k 表域：真值 tiktoken/estimated=false，数值与 node 精确档同口径', async () => {
    const {__test__} = require('@novel-master/tokenizer-driver-rn');

    // vendor 前缀形态（openai/gpt-4o）：直查不认识 → 走 core 映射第二跳 → o200k。
    const en = await __test__.countSerialized(
      'tiktoken',
      'system prompt for gpt',
      'openai/gpt-4o',
    );
    expect(mockCountPrompt).not.toHaveBeenCalled();
    expect(en).toEqual({
      count: 12,
      counterKind: 'tiktoken',
      estimated: false,
    });

    // 中文双字节同表复核。期望值来源：node 精确档（WASM tiktoken o200k 表 +
    // 同一段 core countOpenAiStyleMessages）在 worktree 现跑取得——同算法同表，
    // 容差 0（T-FA6 对拍口径）。
    const zh = await __test__.countSerialized('tiktoken', ZH_TEXT, 'openai/gpt-4o');
    expect(zh).toEqual({
      count: 47,
      counterKind: 'tiktoken',
      estimated: false,
    });
  });

  it('GPT 家族 cl100k 表域（裸模型名直查命中）：同口径真值；连续两次计数第二次不炸（无 free）', async () => {
    const {__test__} = require('@novel-master/tokenizer-driver-rn');

    // 裸标准 id（gpt-4）直查即命中 cl100k，不走映射第二跳。期望值同上：node
    // 精确档现跑（WASM cl100k 表 + core countOpenAiStyleMessages）。
    const first = await __test__.countSerialized('tiktoken', ZH_TEXT, 'gpt-4');
    expect(first).toEqual({
      count: 63,
      counterKind: 'tiktoken',
      estimated: false,
    });

    // 无 free 行为锁定（T-FA6）：编码表是共享单例，连续两次计数第二次必须复用
    // 同一句柄且仍报精确档。真 js-tiktoken 句柄**没有** free 方法——若实现误调
    // free 会 TypeError 落进 catch 变 heuristic；断言第二次仍 tiktoken/false/同值
    // 即钉住「绝不 free」。
    const second = await __test__.countSerialized('tiktoken', ZH_TEXT, 'gpt-4');
    expect(second).toEqual(first);
    expect(second.counterKind).toBe('tiktoken');
    expect(second.estimated).toBe(false);
  });

  it('p50k / gpt2 家族出界：走 cl100k 兜底报 heuristic（边界声明，不冒充精确）', async () => {
    const {__test__} = require('@novel-master/tokenizer-driver-rn');

    // 真 p50k 域代表是 text-davinci-003（completion 系，tiktoken 官方映射
    // p50k_base）。注意 gpt-3.5-turbo-0301 **不是** p50k——官方映射里 chat 系
    // 0301 就是 cl100k_base，那条路径走的是精确档（与 node 同口径），不是兜底。
    // 另外出界判定必须发生在 core 模型名映射**之前**：core 会把 text-davinci-003
    // 改写成 gpt-3.5-turbo（cl100k），映射后再判就把 p50k 模型冒充成精确读数了。
    const p50k = await __test__.countSerialized(
      'tiktoken',
      ZH_TEXT,
      'text-davinci-003',
    );
    expect(p50k).toEqual({
      count: cl100kCount(ZH_TEXT),
      counterKind: 'heuristic',
      estimated: true,
    });

    // gpt2 家族同样路由进 countTiktoken：编码名 gpt2 不在两表域 → 兜底。
    const gpt2 = await __test__.countSerialized('gpt2', ZH_TEXT, 'gpt2');
    expect(gpt2).toEqual(p50k);
  });

  it('表源注入钩子：setEncodingSourceForTests 可控 countTiktoken 的表源分支', async () => {
    const {__test__} = require('@novel-master/tokenizer-driver-rn');
    __test__.setEncodingSourceForTests(() => ({
      encode: (text: string) => ({length: text.length}),
    }));

    // 假表按「字符数」计：precise 档包装 = 3 (perMessage) + encode('system') +
    // encode(content) + 3 (尾部) = 3 + 6 + 6 + 3 = 18。验证 countTiktoken 的
    // 表取用口确实被注入源接管（原 setTiktokenModuleForTests 钩子的替代形态）。
    const result = await __test__.countSerialized(
      'tiktoken',
      'abcdef',
      'openai/gpt-4o',
    );
    expect(result).toEqual({
      count: 18,
      counterKind: 'tiktoken',
      estimated: false,
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

  it('原生桥 reject（Kotlin 新契约）：JS 桥 catch→null 承接，走 cl100k 兜底报 heuristic', async () => {
    // fa Step 4 后 Kotlin 失败一律 promise.reject（不再 resolve 折算值），
    // 「原生返回 estimated:true 半失败读数」不再有产生源；JS 侧由
    // countPromptViaNative 现成的 catch→null 分支承接，落兜底计数（T-FA5）。
    mockCountPrompt.mockRejectedValue(new Error('TOKENIZER_COUNT_FAILED'));
    const {__test__} = require('@novel-master/tokenizer-driver-rn');

    const result = await __test__.countSerialized(
      'gemma',
      'short prompt',
      'gemini-2.0-flash',
    );

    expect(result).toEqual({
      count: cl100kCount('short prompt'),
      counterKind: 'heuristic',
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

/**
 * T-TC5（message-token-cache Step 3）rn 侧：驱动层 L1/L2 的调用计数断言。
 * 口径与 node 侧一致——缓存全命中时 encode / 桥调用 0 次；单块内部可能被
 * 增量计数器按自然边界多切（spec 注记），不得断言「单块 = 1 次 encode」，
 * 局部性用例以无标点连续中文夹具把变化块内部钉在 1 段。
 */
describe('T-TC5 驱动缓存（message-token-cache Step 3 / rn）', () => {
  beforeEach(() => {
    mockCountPrompt.mockReset();
    nativeBridgeState.available = true;
    // L1/L2 是进程级单例：跨用例清空，避免被上方既有用例的缓存条目污染。
    const {promptWholeCache, tokenChunkCache} = require('@novel-master/core/provider');
    promptWholeCache.clearForTests();
    tokenChunkCache.clearForTests();
  });

  afterEach(() => {
    const {
      __test__,
      __resetRnEncodingCacheForTests,
      __setRnEncodingFactoryForTests,
    } = require('@novel-master/tokenizer-driver-rn');
    __setRnEncodingFactoryForTests(null);
    __resetRnEncodingCacheForTests();
    __test__.setEncodingSourceForTests(null);
  });

  it('native 档：同输入两次计数，第二次原生桥调用 0 次（L1 命中不过桥）', async () => {
    mockCountPrompt.mockResolvedValue({
      tokenCount: 42,
      counterKind: 'claude',
      estimated: false,
    });
    const {countPromptLlmInputRn} = require('@novel-master/tokenizer-driver-rn');
    const params = {
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
      savedModelId: 'anthropic/claude-3-5-sonnet',
      registry: {
        heuristic: {countText: (text: string) => Math.ceil(text.length / 3.35)},
      },
    };

    const first = await countPromptLlmInputRn(params);
    expect(first.tokenCount).toBe(42);
    expect(first.counterKind).toBe('claude');
    expect(mockCountPrompt).toHaveBeenCalledTimes(1);

    const second = await countPromptLlmInputRn(params);
    expect(second.tokenCount).toBe(42);
    expect(second.counterKind).toBe('claude');
    expect(second.estimated).toBe(false);
    expect(mockCountPrompt).toHaveBeenCalledTimes(
      1,
      'L1 命中：同输入第二次不得再过原生桥',
    );
  });

  it('JS 档：同输入两次计数，第二次编码表 encode 调用 0 次（L1 命中）', async () => {
    let encodeCalls = 0;
    const {__test__, countPromptLlmInputRn} = require('@novel-master/tokenizer-driver-rn');
    __test__.setEncodingSourceForTests(() => ({
      encode: (text: string) => {
        encodeCalls += 1;
        return {length: text.length};
      },
    }));

    const params = {
      layout: {persist: [], dynamic: []},
      ctx: {workplaceDisplay: '', messages: []},
      savedModelId: 'openai/gpt-4o',
      registry: {
        heuristic: {countText: (text: string) => Math.ceil(text.length / 3.35)},
      },
    };
    const first = await countPromptLlmInputRn(params);
    expect(first.counterKind).toBe('tiktoken');
    const callsAfterFirst = encodeCalls;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await countPromptLlmInputRn(params);
    expect(second.tokenCount).toBe(first.tokenCount);
    expect(mockCountPrompt).not.toHaveBeenCalled();
    expect(encodeCalls).toBe(
      callsAfterFirst,
      'L1 命中：同输入第二次不得再调编码表 encode',
    );
  });

  it('JS 档：改一处正文后仅变化块重算（新增 encode 调用 = 变化块数 + 1 次 role encode）', async () => {
    let encodeCalls = 0;
    const {__test__} = require('@novel-master/tokenizer-driver-rn');
    __test__.setEncodingSourceForTests(() => ({
      encode: (text: string) => {
        encodeCalls += 1;
        return {length: text.length};
      },
    }));

    // 无标点连续中文：块内无自然边界，增量计数器对每块恰好 1 次 encode
    // （夹具控制，见 describe 头注记）。
    const baseText =
      '这是一段完全没有标点与空白的连续中文正文用来验证编辑局部性'.repeat(6);
    const first = await __test__.countSerialized(
      'tiktoken',
      baseText,
      'openai/gpt-4o',
    );
    expect(first.counterKind).toBe('tiktoken');
    const callsAfterFirst = encodeCalls;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const editedText = baseText.replace('连续', '衔接');
    expect(editedText).not.toBe(baseText);
    const second = await __test__.countSerialized(
      'tiktoken',
      editedText,
      'openai/gpt-4o',
    );
    expect(second.counterKind).toBe('tiktoken');

    const {splitTextIntoChunks, chunkHash16} = require('@novel-master/core/provider');
    const hashesA = splitTextIntoChunks(baseText).map((c: string) => chunkHash16(c));
    const hashesB = splitTextIntoChunks(editedText).map((c: string) => chunkHash16(c));
    expect(hashesA.length).toBe(hashesB.length);
    let changedChunks = 0;
    for (let i = 0; i < hashesA.length; i += 1) {
      if (hashesA[i] !== hashesB[i]) {
        changedChunks += 1;
      }
    }
    expect(changedChunks).toBe(1);
    // +1 = overhead 路径对 role "system" 的 encode（无边界恒 1 段）。
    expect(encodeCalls - callsAfterFirst).toBe(changedChunks + 1);
  });
});
