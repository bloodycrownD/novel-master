import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChatMessageDto } from '@shared/ipc-types';
import {
  buildMessageActionItems,
  isSetFloorEligibleMessage,
} from '@/features/chat/message-edit';

function msg(
  contentBlocks: NonNullable<ChatMessageDto['contentBlocks']>,
  role: ChatMessageDto['role'] = 'user',
): ChatMessageDto {
  return {
    id: 'm1',
    sessionId: 's1',
    seq: 1,
    role,
    contentBlocks,
    hidden: false,
    createdAtMs: 1,
    bodyText: '',
  };
}

describe('isSetFloorEligibleMessage', () => {
  it('allows user role only', () => {
    assert.equal(
      isSetFloorEligibleMessage(msg([{ type: 'text', text: 'hi' }])),
      true,
    );
    assert.equal(
      isSetFloorEligibleMessage(
        msg([{ type: 'text', text: 'reply' }], 'assistant'),
      ),
      false,
    );
  });

  it('rejects system role', () => {
    assert.equal(
      isSetFloorEligibleMessage(
        msg([{ type: 'text', text: 'sys' }], 'system'),
      ),
      false,
    );
  });
});

describe('buildMessageActionItems', () => {
  it('includes edit, copy, set-floor, fork, rollback for editable user messages', () => {
    const actions = buildMessageActionItems(
      msg([{ type: 'text', text: 'hi' }]),
    ).map(i => i.action);
    assert.deepEqual(actions, [
      'edit',
      'copy',
      'set-floor',
      'fork',
      'rollback',
    ]);
  });

  it('excludes set-floor for assistant messages with text and tool_use', () => {
    const actions = buildMessageActionItems(
      msg(
        [
          { type: 'text', text: 'reply' },
          { type: 'tool_use', id: 't1', name: 'vfs.read', input: {} },
        ],
        'assistant',
      ),
    ).map(i => i.action);
    assert.deepEqual(actions, ['edit', 'copy', 'fork', 'rollback']);
  });

  it('excludes set-floor when assistant has only tool_use blocks', () => {
    const actions = buildMessageActionItems(
      msg(
        [{ type: 'tool_use', id: 't1', name: 'vfs.read', input: {} }],
        'assistant',
      ),
    ).map(i => i.action);
    assert.deepEqual(actions, ['copy', 'fork', 'rollback']);
  });

  it('hidden user 消息含置位、无 rollback', () => {
    const actions = buildMessageActionItems({
      ...msg([{ type: 'text', text: 'hi' }]),
      hidden: true,
    }).map(i => i.action);
    assert.deepEqual(actions, ['edit', 'copy', 'set-floor', 'fork']);
  });

  it('set-floor 在 copy 之后、fork 之前', () => {
    const items = buildMessageActionItems(msg([{ type: 'text', text: 'hi' }]));
    const copyIdx = items.findIndex(i => i.action === 'copy');
    const setFloorIdx = items.findIndex(i => i.action === 'set-floor');
    const forkIdx = items.findIndex(i => i.action === 'fork');
    assert.ok(copyIdx >= 0);
    assert.equal(setFloorIdx, copyIdx + 1);
    assert.equal(forkIdx, setFloorIdx + 1);
  });
});
