/**
 * AttachmentDraftChips：状态 chip；无 attach 可叉行（T-UI1 / T-ATD1 / T-CHIP1）。
 */
import { describe, expect, it, jest } from '@jest/globals';
import {
  formatAttachmentChipLabel,
  isComposerStatusAttachment,
  partitionComposerChipAttachments,
} from '../src/components/chat/AttachmentDraftChips';
import type { MessageAttachment } from '@novel-master/core/chat';

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      surface: '#111',
      border: '#222',
      text: '#fff',
      textSecondary: '#ccc',
      warning: '#FF9500',
    },
  }),
}));

function attach(
  partial: Partial<MessageAttachment> &
    Pick<MessageAttachment, 'type' | 'source'>,
): MessageAttachment {
  return {
    name: partial.name ?? partial.path ?? 'x',
    content: null,
    path: partial.path ?? null,
    ...partial,
  };
}

describe('formatAttachmentChipLabel (T-UI1 / T-CHIP1)', () => {
  it('workplace 为「规则:/path」', () => {
    expect(
      formatAttachmentChipLabel(
        attach({
          source: 'workplace',
          type: 'text',
          path: '/w.md',
          name: 'w.md',
        }),
      ),
    ).toBe('规则:/w.md');
  });

  it('workplace 目录为「规则:/dir」（无 emoji /「规则 ·」）', () => {
    expect(
      formatAttachmentChipLabel(
        attach({
          source: 'workplace',
          type: 'dir',
          path: '/notes',
          name: 'notes',
        }),
      ),
    ).toBe('规则:/notes');
  });

  it('user_ops 有 action 时为中文二字:path', () => {
    expect(
      formatAttachmentChipLabel(
        attach({
          source: 'user_ops',
          type: 'text',
          path: '/ops.md',
          name: '/ops.md',
          action: 'edit',
        }),
      ),
    ).toBe('编辑:/ops.md');
  });

  it('annotate 预览为「批注:/path」', () => {
    expect(
      formatAttachmentChipLabel(
        attach({
          source: 'user_ops',
          type: 'text',
          path: '/c.md',
          name: '/c.md',
          action: 'annotate',
        }),
      ),
    ).toBe('批注:/c.md');
  });
});

describe('partitionComposerChipAttachments (T-ATD1 / T-AT1)', () => {
  it('仅状态 → 无 attach 可叉行', () => {
    const items = [
      attach({ source: 'workplace', type: 'text', path: '/w.md' }),
      attach({ source: 'user_ops', type: 'text', path: '/u.md' }),
    ];
    const { status, attach: attachOnly } =
      partitionComposerChipAttachments(items);
    expect(status.map(a => a.source)).toEqual(['workplace', 'user_ops']);
    expect(attachOnly).toHaveLength(0);
    expect(status.every(isComposerStatusAttachment)).toBe(true);
  });

  it('userAttach / attach 不进状态 chip', () => {
    expect(
      isComposerStatusAttachment(
        attach({
          source: 'attach',
          type: 'text',
          path: '/a.md',
          action: 'userAttach',
        }),
      ),
    ).toBe(false);
  });

  it('annotate 预览进状态 chip', () => {
    expect(
      isComposerStatusAttachment(
        attach({
          source: 'user_ops',
          type: 'text',
          path: '/c.md',
          action: 'annotate',
        }),
      ),
    ).toBe(true);
  });
});
