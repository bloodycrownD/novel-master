import {describe, expect, it} from '@jest/globals';
import {
  readChatComposerDraft,
  writeChatComposerDraft,
} from '../src/storage/chat-composer-draft';

describe('chat-composer-draft', () => {
  it('reads and writes per session', () => {
    writeChatComposerDraft('s1', 'hello');
    expect(readChatComposerDraft('s1')).toBe('hello');
    expect(readChatComposerDraft('s2')).toBe('');
  });

  it('clears draft when text is empty', () => {
    writeChatComposerDraft('s3', 'draft');
    writeChatComposerDraft('s3', '');
    expect(readChatComposerDraft('s3')).toBe('');
  });
});
