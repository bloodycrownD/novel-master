import type {ChatMessage} from '@novel-master/core';
import {
  applyTextEditToMessage,
  editableTextFromMessage,
} from '../src/components/chat/message-edit';

function msg(
  role: string,
  blocks: ChatMessage['content']['blocks'],
): ChatMessage {
  return {
    id: 'm1',
    sessionId: 's1',
    seq: 1,
    role,
    content: {blocks},
    provider: null,
    raw: null,
    createdAtMs: 1,
    hidden: false,
  };
}

describe('message-edit', () => {
  it('allows editing plain text user and assistant messages', () => {
    expect(
      editableTextFromMessage(msg('user', [{type: 'text', text: 'hello'}])),
    ).toBe('hello');
    expect(
      editableTextFromMessage(
        msg('assistant', [{type: 'text', text: 'reply'}]),
      ),
    ).toBe('reply');
  });

  it('allows editing text when tool_use blocks are present', () => {
    expect(
      editableTextFromMessage(
        msg('assistant', [
          {type: 'text', text: 'before tools'},
          {type: 'tool_use', id: 't1', name: 'vfs.read', input: {}},
        ]),
      ),
    ).toBe('before tools');
  });

  it('returns null for pure tool_use assistant messages', () => {
    expect(
      editableTextFromMessage(
        msg('assistant', [
          {type: 'tool_use', id: 't1', name: 'vfs.read', input: {}},
        ]),
      ),
    ).toBeNull();
  });

  it('applyTextEditToMessage preserves tool_use and thinking block order', () => {
    const original = msg('assistant', [
      {type: 'thinking', text: 'hmm'},
      {type: 'text', text: 'old'},
      {type: 'tool_use', id: 't1', name: 'vfs.read', input: {path: '/a'}},
      {type: 'text', text: 'tail'},
    ]);
    const merged = applyTextEditToMessage(original, 'new body');
    expect(merged.blocks).toEqual([
      {type: 'thinking', text: 'hmm'},
      {type: 'text', text: 'new body'},
      {type: 'tool_use', id: 't1', name: 'vfs.read', input: {path: '/a'}},
    ]);
  });
});
