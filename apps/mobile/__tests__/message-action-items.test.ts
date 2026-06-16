import type {ChatMessage} from '@novel-master/core';
import {buildMessageActionItems} from '../src/components/chat/message-edit';

function msg(
  blocks: ChatMessage['content']['blocks'],
  role: ChatMessage['role'] = 'user',
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

describe('buildMessageActionItems', () => {
  it('includes edit, copy, fork, rollback for editable messages', () => {
    const actions = buildMessageActionItems(
      msg([{type: 'text', text: 'hi'}]),
    ).map(i => i.action);
    expect(actions).toEqual(['edit', 'copy', 'fork', 'rollback']);
  });

  it('includes edit for assistant messages with text and tool_use', () => {
    const actions = buildMessageActionItems(
      msg(
        [
          {type: 'text', text: 'reply'},
          {type: 'tool_use', id: 't1', name: 'vfs.read', input: {}},
        ],
        'assistant',
      ),
    ).map(i => i.action);
    expect(actions).toEqual(['edit', 'copy', 'fork', 'rollback']);
  });

  it('omits edit when message has only tool_use blocks', () => {
    const actions = buildMessageActionItems(
      msg(
        [{type: 'tool_use', id: 't1', name: 'vfs.read', input: {}}],
        'assistant',
      ),
    ).map(i => i.action);
    expect(actions).toEqual(['copy', 'fork', 'rollback']);
  });
});
