import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChatMessageDto, MessageAttachmentDto } from '@shared/ipc-types';
import {
  isPlainUserUndoSendEligible,
  type RollbackMode,
} from '@shared/logic/chat';
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
  it('T-TX2: plain user undo_send 恢复原文（含 @路径）；无文件引用 attach chip', () => {
    const anchorText = '请看 @/a.md';
    const attachments: MessageAttachmentDto[] = [
      {
        name: '/w.md',
        source: 'workplace',
        type: 'text',
        content: null,
        path: '/w.md',
      },
      {
        name: '/a.md',
        source: 'attach',
        type: 'text',
        content: null,
        path: '/a.md',
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
    assert.ok(next.text.includes('@/a.md'));
    assert.equal(next.attachments.length, 0);
    assert.equal(
      next.attachments.some((a) => a.source === 'attach'),
      false,
    );
  });

  it('T-W2: assistant rewind 保留正文与 @，剥掉 attach chip（状态留给投影）', () => {
    const { rollbackMode, restoreText, restoreAttachments } =
      resolveRollbackContext(
        msg([{ type: 'text', text: 'assistant reply' }], 'assistant'),
      );

    assert.equal(rollbackMode, 'rewind');
    assert.equal(restoreText, 'assistant reply');

    const next = resolveComposerDraftAfterRollbackSuccess(
      {
        text: 'draft with @/keep.md',
        attachments: [
          {
            name: 'write:/ops.md',
            source: 'user_ops',
            type: 'text',
            content: null,
            path: '/ops.md',
          },
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
    assert.equal(next.text, 'draft with @/keep.md');
    assert.equal(next.attachments.length, 1);
    assert.equal(next.attachments[0]?.source, 'user_ops');
    assert.equal(
      next.attachments.some((a) => a.source === 'attach'),
      false,
    );
  });
});
