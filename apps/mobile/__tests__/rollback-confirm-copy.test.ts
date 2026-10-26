import {describe, expect, it} from '@jest/globals';
import {rollbackConfirm} from '@novel-master/core/chat';
import {chatTranslator} from '@/i18n/chat';

describe('rollback-confirm-copy (mobile)', () => {
  it('T-M1: undo_send primary 含「及之后」', () => {
    const message = chatTranslator(rollbackConfirm.descriptor('undo_send', 'primary'));
    expect(message).toMatch(/及之后/);
    expect(message).toMatch(/撤销相关文件修改/);
  });

  it('rewind primary 含「之后」但不含「及之后」', () => {
    const message = chatTranslator(rollbackConfirm.descriptor('rewind', 'primary'));
    expect(message).toMatch(/之后/);
    expect(message).not.toMatch(/及之后/);
  });
});
