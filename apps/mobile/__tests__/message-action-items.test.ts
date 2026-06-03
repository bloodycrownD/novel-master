import type {ChatMessage} from '@novel-master/core';
import {buildMessageActionItems} from '../src/components/chat/message-edit';

function msg(
  hidden: boolean,
  blocks: ChatMessage['content']['blocks'],
): ChatMessage {
  return {
    id: 'm1',
    sessionId: 's1',
    seq: 1,
    role: 'user',
    content: {blocks},
    provider: null,
    raw: null,
    createdAtMs: 1,
    hidden,
  };
}

describe('buildMessageActionItems', () => {
  it('includes edit, hide, and delete for editable visible messages', () => {
    const actions = buildMessageActionItems(
      msg(false, [{type: 'text', text: 'hi'}]),
    ).map(i => i.action);
    expect(actions).toEqual(['edit', 'hide', 'copy', 'fork', 'rollback', 'delete']);
  });

  it('shows unhide instead of hide for hidden messages', () => {
    const actions = buildMessageActionItems(
      msg(true, [{type: 'text', text: 'hi'}]),
    ).map(i => i.action);
    expect(actions).toEqual(['edit', 'unhide', 'copy', 'fork', 'rollback', 'delete']);
  });

  it('omits edit when message has tool_use blocks', () => {
    const actions = buildMessageActionItems(
      msg(false, [
        {type: 'tool_use', id: 't1', name: 'vfs.read', input: {}},
      ]),
    ).map(i => i.action);
    expect(actions).toEqual(['hide', 'copy', 'fork', 'rollback', 'delete']);
  });
});
