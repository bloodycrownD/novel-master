import {describe, expect, it} from '@jest/globals';
import {
  applyComposerAttachmentsSuggest,
  readChatComposerDraft,
  readChatComposerDraftState,
  writeChatComposerDraft,
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

  it('merges composerAttachmentsSuggest 形状到 attachments（按 path 去重）', () => {
    writeChatComposerDraft('s-rd', 'keep');
    applyComposerAttachmentsSuggest({
      sessionId: 's-rd',
      attachments: [
        {
          name: '/a.md',
          source: 'workplace',
          type: 'text',
          content: null,
          path: '/a.md',
        },
      ],
    });
    applyComposerAttachmentsSuggest({
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
    expect(state.attachments.map(a => a.path)).toEqual(['/a.md', '/b.md']);
  });
});
