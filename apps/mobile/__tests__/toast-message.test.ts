import {toastMessage} from '../src/errors/toast-message';

describe('toastMessage', () => {
  it('returns title only when detail is empty', () => {
    expect(toastMessage('保存失败')).toBe('保存失败');
  });

  it('joins title and string detail', () => {
    expect(toastMessage('读取失败', 'network error')).toBe(
      '读取失败：network error',
    );
  });

  it('formats Error detail', () => {
    expect(toastMessage('保存失败', new Error('boom'))).toBe('保存失败：boom');
  });
});
