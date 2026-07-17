/**
 * AttachmentDraftChips：emoji 文案、双条拆分、目录无 warning 色（T-UI1/T-UI2）。
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

describe('formatAttachmentChipLabel (T-UI1)', () => {
  it('attach 目录为 📁/path', () => {
    expect(
      formatAttachmentChipLabel(
        attach({ source: 'attach', type: 'dir', path: '/555', name: '555' }),
      ),
    ).toBe('📁/555');
  });

  it('attach 文件为 📄/path', () => {
    expect(
      formatAttachmentChipLabel(
        attach({
          source: 'attach',
          type: 'text',
          path: '/a.md',
          name: 'a.md',
        }),
      ),
    ).toBe('📄/a.md');
  });

  it('workplace 为 📄/path', () => {
    expect(
      formatAttachmentChipLabel(
        attach({
          source: 'workplace',
          type: 'text',
          path: '/w.md',
          name: 'w.md',
        }),
      ),
    ).toBe('📄/w.md');
  });

  it('user_ops 为 action:path（无 icon）', () => {
    expect(
      formatAttachmentChipLabel(
        attach({
          source: 'user_ops',
          type: 'text',
          path: '/ops.md',
          name: 'edit:/ops.md',
        }),
      ),
    ).toBe('edit:/ops.md');
  });
});

describe('partitionComposerChipAttachments (T-UI1)', () => {
  it('三类并存 → 上条 workplace+user_ops、下条 attach', () => {
    const items = [
      attach({ source: 'workplace', type: 'text', path: '/w.md' }),
      attach({ source: 'user_ops', type: 'text', path: '/u.md' }),
      attach({ source: 'attach', type: 'text', path: '/a.md' }),
    ];
    const { status, attach: attachOnly } =
      partitionComposerChipAttachments(items);
    expect(status.map(a => a.source)).toEqual(['workplace', 'user_ops']);
    expect(attachOnly.map(a => a.source)).toEqual(['attach']);
    expect(status.every(isComposerStatusAttachment)).toBe(true);
    expect(attachOnly.every(a => a.source === 'attach')).toBe(true);
  });
});

describe('T-UI2 目录无 warning 依赖', () => {
  it('目录 label 用 📁 且不依赖 warning token 文案', () => {
    const label = formatAttachmentChipLabel(
      attach({ source: 'attach', type: 'dir', path: '/d', name: 'd' }),
    );
    expect(label).toBe('📁/d');
    expect(label.includes('warning')).toBe(false);
  });
});
