import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChatMessageDto, MessageAttachmentDto } from '@shared/ipc-types';
import {
  isPlainUserUndoSendEligible,
  type RollbackMode,
} from '@novel-master/core/chat';
import { editableTextFromMessage } from '@/features/chat/message-edit';
import { resolveComposerDraftAfterRollbackSuccess } from '@/features/chat/rollback-composer';
import { chatMessageFromDto } from '@/features/chat/composer-send-state';

function msg(
  contentBlocks: NonNullable<ChatMessageDto['contentBlocks']>,
  role: ChatMessageDto['role'] = 'user',
  attachments?: readonly MessageAttachmentDto[],
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
    ...(attachments != null && attachments.length > 0
      ? { attachments }
      : {}),
  };
}

function resolveRollbackContext(message: ChatMessageDto): {
  rollbackMode: RollbackMode;
  restoreText: string | null;
  restoreAttachments: readonly MessageAttachmentDto[] | null;
} {
  const chatMsg = chatMessageFromDto(message);
  return {
    rollbackMode: isPlainUserUndoSendEligible(chatMsg) ? 'undo_send' : 'rewind',
    restoreText: editableTextFromMessage(message),
    restoreAttachments: message.attachments ?? null,
  };
}

describe('resolveComposerDraftAfterRollbackSuccess', () => {
  it('T-W1/T-TX2: plain user undo_send 恢复原文 + attachments chips', () => {
    const anchorText = '你好';
    const attachments: MessageAttachmentDto[] = [
      {
        name: '/w.md',
        source: 'workplace',
        type: 'text',
        content: null,
        path: '/w.md',
      },
    ];
    const { rollbackMode, restoreText, restoreAttachments } =
      resolveRollbackContext(
        msg([{ type: 'text', text: anchorText }], 'user', attachments),
      );

    assert.equal(rollbackMode, 'undo_send');
    assert.equal(restoreText, anchorText);
    assert.deepEqual(restoreAttachments, attachments);

    const next = resolveComposerDraftAfterRollbackSuccess(
      { text: 'old draft', attachments: [] },
      rollbackMode,
      { text: restoreText, attachments: restoreAttachments },
    );
    assert.equal(next.text, anchorText);
    assert.deepEqual(next.attachments, attachments);
    assert.equal(next.text.includes('<user-input>'), false);
  });

  it('T-W2: assistant rewind 回滚后 composer draft 不变', () => {
    const { rollbackMode, restoreText, restoreAttachments } =
      resolveRollbackContext(
        msg([{ type: 'text', text: 'assistant reply' }], 'assistant'),
      );

    assert.equal(rollbackMode, 'rewind');
    assert.equal(restoreText, 'assistant reply');

    const next = resolveComposerDraftAfterRollbackSuccess(
      {
        text: 'unchanged draft',
        attachments: [
          {
            name: '/keep.md',
            source: 'attach',
            type: 'text',
            content: null,
            path: '/keep.md',
          },
        ],
      },
      rollbackMode,
      { text: restoreText, attachments: restoreAttachments },
    );
    assert.equal(next.text, 'unchanged draft');
    assert.equal(next.attachments.length, 1);
    assert.equal(next.attachments[0]?.path, '/keep.md');
  });
});
