import type {ChatMessage} from '@novel-master/core';
import {editableTextFromMessage} from '../src/components/chat/message-edit';

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

  it('returns null for tool_use messages', () => {
    expect(
      editableTextFromMessage(
        msg('assistant', [
          {type: 'text', text: 'x'},
          {type: 'tool_use', id: 't1', name: 'read', input: {}},
        ]),
      ),
    ).toBeNull();
  });
});
