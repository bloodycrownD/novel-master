import {describe, expect, it, jest} from '@jest/globals';
import {
  applyComposerStatusAttachmentsReplace,
  clearChatComposerDraft,
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
