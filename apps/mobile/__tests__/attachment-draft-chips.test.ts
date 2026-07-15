/**
 * AttachmentDraftChips 文案：目录 `@${path}`，文件 `@ ${path}`。
 */
import {describe, expect, it, jest} from '@jest/globals';
import {formatAttachmentChipLabel} from '../src/components/chat/AttachmentDraftChips';
import type {MessageAttachment} from '@novel-master/core/chat';

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

describe('formatAttachmentChipLabel', () => {
  it('目录 chip（非 workplace）为 @${path} 无空格', () => {
    expect(
      formatAttachmentChipLabel(
        attach({source: 'attach', type: 'dir', path: '/555', name: '555'}),
      ),
    ).toBe('@/555');
  });

  it('文件 chip 保持 @ ${path}', () => {
    expect(
      formatAttachmentChipLabel(
        attach({
          source: 'attach',
          type: 'text',
          path: '/a.md',
          name: 'a.md',
        }),
      ),
    ).toBe('@ /a.md');
  });

  it('workplace 保持「工作区」前缀', () => {
    expect(
      formatAttachmentChipLabel(
        attach({
          source: 'workplace',
          type: 'text',
          path: '/w.md',
          name: 'w.md',
        }),
      ),
    ).toBe('工作区 /w.md');
  });
});
