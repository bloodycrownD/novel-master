import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChatMessageDto } from '@shared/ipc-types';
import {
  isPlainUserUndoSendEligible,
  type RollbackMode,
} from '@novel-master/core/chat';
import { editableTextFromMessage } from '@/features/chat/message-edit';
import { resolveComposerTextAfterRollbackSuccess } from '@/features/chat/rollback-composer';
import { chatMessageFromDto } from '@/features/chat/composer-send-state';

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

function resolveRollbackContext(message: ChatMessageDto): {
  rollbackMode: RollbackMode;
  restoreText: string | null;
} {
  const chatMsg = chatMessageFromDto(message);
  return {
    rollbackMode: isPlainUserUndoSendEligible(chatMsg) ? 'undo_send' : 'rewind',
    restoreText: editableTextFromMessage(message),
  };
}

describe('resolveComposerTextAfterRollbackSuccess', () => {
  it('T-W1: plain user undo_send 成功后 composerText 恢复为锚点原文', () => {
    const anchorText = 'anchor text';
    const { rollbackMode, restoreText } = resolveRollbackContext(
      msg([{ type: 'text', text: anchorText }]),
    );

    assert.equal(rollbackMode, 'undo_send');
    assert.equal(restoreText, anchorText);

    const nextComposerText = resolveComposerTextAfterRollbackSuccess(
      'old draft',
      rollbackMode,
      restoreText,
    );
    assert.equal(nextComposerText, anchorText);
  });

  it('T-W2: assistant rewind 回滚后 composerText 不变', () => {
    const unchanged = 'unchanged draft';
    const { rollbackMode, restoreText } = resolveRollbackContext(
      msg([{ type: 'text', text: 'assistant reply' }], 'assistant'),
    );

    assert.equal(rollbackMode, 'rewind');
    assert.equal(restoreText, 'assistant reply');

    const nextComposerText = resolveComposerTextAfterRollbackSuccess(
      unchanged,
      rollbackMode,
      restoreText,
    );
    assert.equal(nextComposerText, unchanged);
  });
});
