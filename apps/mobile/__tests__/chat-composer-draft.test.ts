import {describe, expect, it} from '@jest/globals';
import {
  applyComposerStatusAttachmentsReplace,
  readChatComposerDraft,
  readChatComposerDraftState,
  writeChatComposerDraft,
  writeChatComposerDraftState,
} from '../src/storage/chat-composer-draft';

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

  it('整表替换状态条；保留 attach（T-UI1 方向）', () => {
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
      'attach:/ref.md',
    ]);
  });
});
