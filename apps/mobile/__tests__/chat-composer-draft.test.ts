import {describe, expect, it, jest} from '@jest/globals';
import {
  applyComposerStatusAttachmentsReplace,
  clearChatComposerDraft,
  hydrateChatComposerDraftFromDb,
  readChatComposerDraftState,
  writeChatComposerDraft,
  writeChatComposerDraftState,
} from '../src/storage/chat-composer-draft';
import {
  addChatAnnotateDraft,
  resetChatAnnotateDraftStoreForTests,
} from '@novel-master/core/chat';

describe('chat-composer-draft', () => {
  it('reads and writes per session', () => {
    writeChatComposerDraft('s1', 'hello');
    expect(readChatComposerDraftState('s1').text).toBe('hello');
    expect(readChatComposerDraftState('s2').text).toBe('');
  });

  it('clears draft when text and attachments are empty', () => {
    writeChatComposerDraft('s3', 'draft');
    writeChatComposerDraft('s3', '');
    expect(readChatComposerDraftState('s3').text).toBe('');
  });

  it('整表替换状态条；不保留 attach', () => {
    writeChatComposerDraftState('s-rd', {
      text: 'keep',
      attachments: [
        {
          name: '/ref.md',
          source: 'attach',
          type: 'text',
          content: null,
          path: '/ref.md',
        },
      ],
    });
    applyComposerStatusAttachmentsReplace({
      sessionId: 's-rd',
      attachments: [
        {
          name: '/a.md',
          source: 'workplace',
          type: 'text',
          content: null,
          path: '/a.md',
        },
        {
          name: '/u.md',
          source: 'user_ops',
          type: 'text',
          content: null,
          path: '/u.md',
        },
      ],
    });
    applyComposerStatusAttachmentsReplace({
      sessionId: 's-rd',
      attachments: [
        {
          name: '/b.md',
          source: 'workplace',
          type: 'text',
          content: null,
          path: '/b.md',
        },
      ],
    });
    const state = readChatComposerDraftState('s-rd');
    expect(state.text).toBe('keep');
    expect(state.attachments.map(a => `${a.source}:${a.path}`)).toEqual([
      'workplace:/b.md',
    ]);
    expect(state.attachments.every(a => a.source !== 'attach')).toBe(true);
  });

  it('T-AN1: replace projected 后再 ∪ annotate，chip 不被冲掉', () => {
    resetChatAnnotateDraftStoreForTests();
    const sessionId = 's-an1-m';
    addChatAnnotateDraft(sessionId, {
      id: 'a1',
      path: '/note.md',
      originalText: 'sel',
      userAnnotation: 'mark',
    });
    addChatAnnotateDraft(sessionId, {
      id: 'a2',
      path: '/note.md',
      originalText: 'sel2',
      userAnnotation: 'mark2',
    });
    writeChatComposerDraftState(sessionId, {
      text: '',
      attachments: [],
    });
    applyComposerStatusAttachmentsReplace({
      sessionId,
      attachments: [
        {
          name: '/w.md',
          source: 'workplace',
          type: 'text',
          content: null,
          path: '/w.md',
          action: 'workplaceChange',
        },
      ],
    });
    const state = readChatComposerDraftState(sessionId);
    expect(
      state.attachments.map(a => `${a.action ?? a.source}:${a.path}`),
    ).toEqual(['workplaceChange:/w.md', 'annotate:/note.md']);
    // 同 path 两条草稿仍只一只 chip
    expect(state.attachments.filter(a => a.action === 'annotate').length).toBe(
      1,
    );
    resetChatAnnotateDraftStoreForTests();
  });

  it('CD-5: hydrateChatComposerDraftFromDb 遇非法附件不清空正文', async () => {
    // 历史行：草稿正文写到一半，attachments 数组里混了一条今天不合法的
    // 附件（未知键 → .strict() 拒绝）。旧口径整对象一次 safeParse 会连带
    // 正文一起判废；新口径逐条丢弃非法项，正文逐字保留。
    const raw = JSON.stringify({
      text: '我写了一半',
      attachments: [
        {
          name: '/ref.md',
          source: 'attach',
          type: 'text',
          content: null,
          path: '/ref.md',
          legacyUnknownKey: 'x',
        },
      ],
    });
    const sessions = {
      getComposerDraftJson: jest.fn(async () => raw),
      setComposerDraftJson: jest.fn(async () => true),
    };

    const hydrated = await hydrateChatComposerDraftFromDb('s-cd5', sessions);

    // 断言写成「等于具体那个非空字符串」：写「非空」在返回空串时恒红、
    // 在返回 undefined 时恒绿，两种退化都测不出牙齿。
    expect(hydrated.text).toBe('我写了一半');
    expect(readChatComposerDraftState('s-cd5').text).toBe('我写了一半');
    // 非法附件被逐条丢弃；且草稿 attach chip 本就不映回（只保留状态条）。
    expect(hydrated.attachments).toEqual([]);
    expect(sessions.getComposerDraftJson).toHaveBeenCalledWith('s-cd5');
  });
});

/**
 * T-CA2（mobile 存储侧）：tokenRanges 全链透传（D1）。
 *
 * 口径必须锁死：`undefined`（旧草稿 / 带外写入，允许兜底扫描）≠ `[]`
 * （确认无胶囊，禁止扫描）；序列化侧 undefined **不写自有键**。
 */
describe('chat-composer-draft · tokenRanges 持久化（D1）', () => {
  it('T-CA2: 带 ranges 写→读 roundtrip（缓存 / DB JSON / 水化逐字段相等）', async () => {
    let stored: string | null = null;
    const sessions = {
      getComposerDraftJson: jest.fn(async () => stored),
      setComposerDraftJson: jest.fn(async (_id: string, json: string | null) => {
        stored = json;
        return true;
      }),
    };
    const ranges = [
      {start: 0, end: 3},
      {start: 8, end: 15},
    ];

    writeChatComposerDraftState(
      's-ca2-storage',
      {text: '$技能 中间 $另一个', attachments: [], tokenRanges: ranges},
      sessions,
    );

    expect(readChatComposerDraftState('s-ca2-storage').tokenRanges).toEqual(
      ranges,
    );
    await new Promise(resolve => setImmediate(resolve));
    expect(JSON.parse(stored!)).toEqual({
      text: '$技能 中间 $另一个',
      attachments: [],
      tokenRanges: ranges,
    });

    const hydrated = await hydrateChatComposerDraftFromDb(
      's-ca2-storage',
      sessions,
    );
    expect(hydrated.tokenRanges).toEqual(ranges);
    expect(readChatComposerDraftState('s-ca2-storage').tokenRanges).toEqual(
      ranges,
    );
  });

  it('T-CA2: 无 ranges（undefined）→ JSON 与缓存对象都没有 tokenRanges 自有键', async () => {
    let stored: string | null = null;
    const sessions = {
      getComposerDraftJson: jest.fn(async () => stored),
      setComposerDraftJson: jest.fn(async (_id: string, json: string | null) => {
        stored = json;
        return true;
      }),
    };

    // 三参调用（既有形态，零改动）：undefined 原样透传，不臆造 `[]`。
    writeChatComposerDraft('s-ca2-undef', '手输 $foo', sessions);

    const cached = readChatComposerDraftState('s-ca2-undef');
    expect(Object.prototype.hasOwnProperty.call(cached, 'tokenRanges')).toBe(
      false,
    );
    await new Promise(resolve => setImmediate(resolve));
    const payload = JSON.parse(stored!) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(payload, 'tokenRanges')).toBe(
      false,
    );

    // 旧 JSON 水化：parse 不写自有键，缓存条目同样没有。
    const hydrated = await hydrateChatComposerDraftFromDb(
      's-ca2-undef',
      sessions,
    );
    expect(Object.prototype.hasOwnProperty.call(hydrated, 'tokenRanges')).toBe(
      false,
    );
    expect(
      Object.prototype.hasOwnProperty.call(
        readChatComposerDraftState('s-ca2-undef'),
        'tokenRanges',
      ),
    ).toBe(false);
  });

  it('T-CA2: 空数组 []（确认无胶囊）roundtrip 保留，不退化为 undefined', async () => {
    let stored: string | null = null;
    const sessions = {
      getComposerDraftJson: jest.fn(async () => stored),
      setComposerDraftJson: jest.fn(async (_id: string, json: string | null) => {
        stored = json;
        return true;
      }),
    };

    writeChatComposerDraftState(
      's-ca2-empty',
      {text: '手输$foo', attachments: [], tokenRanges: []},
      sessions,
    );
    await new Promise(resolve => setImmediate(resolve));

    const payload = JSON.parse(stored!) as Record<string, unknown>;
    expect(payload.tokenRanges).toEqual([]);

    const hydrated = await hydrateChatComposerDraftFromDb(
      's-ca2-empty',
      sessions,
    );
    expect(hydrated.tokenRanges).toEqual([]);
  });

  it('T-CA2/P0-2: applyComposerStatusAttachmentsReplace 保留 prev.tokenRanges（[] 不被投影链抹掉）', () => {
    // 水化链 hydrate → project → apply：投影重建缓存条目时丢字段会让
    // 「确认无胶囊」退化为 undefined，手输 `$foo` 每次水化被升格。
    writeChatComposerDraftState('s-ca2-replace', {
      text: '手输$foo',
      attachments: [],
      tokenRanges: [],
    });

    applyComposerStatusAttachmentsReplace({
      sessionId: 's-ca2-replace',
      attachments: [
        {
          name: '/w.md',
          source: 'workplace',
          type: 'text',
          content: null,
          path: '/w.md',
        },
      ],
    });

    expect(readChatComposerDraftState('s-ca2-replace').tokenRanges).toEqual([]);

    // 有值场景同样保留（引用落文后投影刷新不发丢区间）。
    writeChatComposerDraftState('s-ca2-replace2', {
      text: '$技能',
      attachments: [],
      tokenRanges: [{start: 0, end: 3}],
    });
    applyComposerStatusAttachmentsReplace({
      sessionId: 's-ca2-replace2',
      attachments: [],
    });
    expect(readChatComposerDraftState('s-ca2-replace2').tokenRanges).toEqual([
      {start: 0, end: 3},
    ]);
  });

  it('T-CA2: 第 4 参覆盖写（undefined 明确清掉旧区间，供全屏回填 undefined 口径）', async () => {
    writeChatComposerDraftState('s-ca2-override', {
      text: '$技能',
      attachments: [],
      tokenRanges: [{start: 0, end: 3}],
    });
    expect(readChatComposerDraftState('s-ca2-override').tokenRanges).toEqual([
      {start: 0, end: 3},
    ]);

    writeChatComposerDraft('s-ca2-override', '改写后的正文');
    expect(
      Object.prototype.hasOwnProperty.call(
        readChatComposerDraftState('s-ca2-override'),
        'tokenRanges',
      ),
    ).toBe(false);
  });
});


describe('chat-composer-draft 持久化失败（infra/B-2）', () => {
  it('setComposerDraftJson reject：warn 有日志、无 unhandled rejection、内存缓存不受影响', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    const sessions = {
      getComposerDraftJson: jest.fn(async () => null),
      setComposerDraftJson: jest.fn(async () => {
        throw new Error('db locked');
      }),
    };
    try {
      // 覆盖三条 void 落库路径：persistAttachTextDraft、两侧皆空 set null、clear set null。
      writeChatComposerDraft('s-persist', 'hello', sessions);
      writeChatComposerDraftState(
        's-persist',
        {
          text: 'state',
          attachments: [],
        },
        sessions,
      );
      writeChatComposerDraft('s-persist', '', sessions);
      writeChatComposerDraftState(
        's-persist',
        {
          text: '',
          attachments: [],
        },
        sessions,
      );
      clearChatComposerDraft('s-persist', sessions);
      await new Promise(resolve => setImmediate(resolve));

      expect(warnSpy).toHaveBeenCalledWith(
        '[chat-composer-draft] persist draft failed:',
        expect.objectContaining({message: 'db locked'}),
      );
      expect(unhandled).toEqual([]);
      // 落库失败不影响内存缓存语义。
      expect(readChatComposerDraftState('s-persist').text).toBe('');
    } finally {
      process.off('unhandledRejection', onUnhandled);
      warnSpy.mockRestore();
    }
  });
});
