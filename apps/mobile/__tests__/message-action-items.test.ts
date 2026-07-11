import { type ChatMessage } from "@novel-master/core/chat";
import {
  buildMessageActionItems,
  isSetFloorEligibleMessage,
} from '../src/components/chat/message-edit';

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

describe('isSetFloorEligibleMessage', () => {
  it('allows user and assistant roles', () => {
    expect(isSetFloorEligibleMessage(msg([{type: 'text', text: 'hi'}]))).toBe(
      true,
    );
    expect(
      isSetFloorEligibleMessage(
        msg([{type: 'text', text: 'reply'}], 'assistant'),
      ),
    ).toBe(true);
  });

  it('rejects system role', () => {
    expect(
      isSetFloorEligibleMessage(
        msg([{type: 'text', text: 'sys'}], 'system'),
      ),
    ).toBe(false);
  });
});

describe('buildMessageActionItems', () => {
  it('includes edit, copy, set-floor, fork, rollback for editable messages', () => {
    const actions = buildMessageActionItems(
      msg([{type: 'text', text: 'hi'}]),
    ).map(i => i.action);
    expect(actions).toEqual(['edit', 'copy', 'set-floor', 'fork', 'rollback']);
  });

  it('includes set-floor for assistant messages with text and tool_use', () => {
    const actions = buildMessageActionItems(
      msg(
        [
          {type: 'text', text: 'reply'},
          {type: 'tool_use', id: 't1', name: 'vfs.read', input: {}},
        ],
        'assistant',
      ),
    ).map(i => i.action);
    expect(actions).toEqual(['edit', 'copy', 'set-floor', 'fork', 'rollback']);
  });

  it('includes set-floor when message has only tool_use blocks', () => {
    const actions = buildMessageActionItems(
      msg(
        [{type: 'tool_use', id: 't1', name: 'vfs.read', input: {}}],
        'assistant',
      ),
    ).map(i => i.action);
    expect(actions).toEqual(['copy', 'set-floor', 'fork', 'rollback']);
  });

  it('hidden 消息含置位、无 rollback', () => {
    const actions = buildMessageActionItems({
      ...msg([{type: 'text', text: 'hi'}]),
      hidden: true,
    }).map(i => i.action);
    expect(actions).toEqual(['edit', 'copy', 'set-floor', 'fork']);
  });

  it('set-floor 在 copy 之后、fork 之前', () => {
    const items = buildMessageActionItems(msg([{type: 'text', text: 'hi'}]));
    const copyIdx = items.findIndex(i => i.action === 'copy');
    const setFloorIdx = items.findIndex(i => i.action === 'set-floor');
    const forkIdx = items.findIndex(i => i.action === 'fork');
    expect(copyIdx).toBeGreaterThanOrEqual(0);
    expect(setFloorIdx).toBe(copyIdx + 1);
    expect(forkIdx).toBe(setFloorIdx + 1);
  });
});
