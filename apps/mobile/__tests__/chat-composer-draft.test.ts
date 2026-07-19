import {describe, expect, it} from '@jest/globals';
import {
  applyComposerStatusAttachmentsReplace,
  readChatComposerDraft,
  readChatComposerDraftState,
  writeChatComposerDraft,
  writeChatComposerDraftState,
} from '../src/storage/chat-composer-draft';
import {
  addChatAnnotateDraft,
  resetChatAnnotateDraftStoreForTests,
} from '../src/storage/chat-annotate-draft';

describe('chat-composer-draft', () => {
  it('reads and writes per session', () => {
    writeChatComposerDraft('s1', 'hello');
    expect(readChatComposerDraft('s1')).toBe('hello');
    expect(readChatComposerDraft('s2')).toBe('');
  });

  it('clears draft when text and attachments are empty', () => {
    writeChatComposerDraft('s3', 'draft');
    writeChatComposerDraft('s3', '');
    expect(readChatComposerDraft('s3')).toBe('');
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
    expect(
      state.attachments.filter(a => a.action === 'annotate').length,
    ).toBe(1);
    resetChatAnnotateDraftStoreForTests();
  });
});
