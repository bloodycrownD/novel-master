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

  it('T-W2: assistant rewind 保留正文与 @，剥掉 attach；ops 半边空（禁止闭包旧 chip 盖回）', () => {
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
    assert.equal(next.attachments.length, 0, 'ops 留给 main suggest；禁止盖回旧 chip');
    assert.equal(
      next.attachments.some((a) => a.source === 'attach'),
      false,
    );
    assert.equal(
      next.attachments.some((a) => a.source === 'user_ops'),
      false,
    );
  });

  it('T-B3: 批注消息 undo_send（restoreText:null + restoreAttachments:非空）正文不覆盖、attach 恒空（批注反投影由 applyUndoAnnotateRestore 独立处理）', () => {
    // 「只有批注、无正文」的 user 消息：isPlainUserUndoSendEligible 返回 true（走 undo_send），
    // 但 extractEditableText 返回 null。desktop 已解耦——正文恢复（本函数）与批注反投影
    // （applyUndoAnnotateRestore）是两次独立调用，restoreText:null 只导致正文不恢复，
    // 不影响批注附件反投影。这里验证 resolveComposerDraftAfterRollbackSuccess 在该输入下
    // 保留当前正文、attach 恒空（批注反投影走另一条路径，不在本函数职责内）。
    const annotateAttachment: MessageAttachmentDto = {
      name: '/a.md',
      source: 'user_ops',
      type: 'text',
      content: null,
      path: '/a.md',
      action: 'annotate',
    };
    const { rollbackMode, restoreText, restoreAttachments } =
      resolveRollbackContext(
        msg([], 'user', [annotateAttachment]),
      );

    assert.equal(rollbackMode, 'undo_send');
    assert.equal(restoreText, null);
    assert.deepEqual(restoreAttachments, [annotateAttachment]);

    const next = resolveComposerDraftAfterRollbackSuccess(
      { text: 'composer 不被覆盖', attachments: [] },
      rollbackMode,
      { text: restoreText, attachments: restoreAttachments },
    );
    assert.equal(next.text, 'composer 不被覆盖');
    assert.equal(next.attachments.length, 0);
  });
});
