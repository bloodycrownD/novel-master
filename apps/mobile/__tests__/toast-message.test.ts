import {ToastMessage} from '@/errors/toast-message'

describe('toastMessage', () => {
    it('returns title only when detail is empty', () => {
        expect(ToastMessage.toast('保存失败')).toBe('保存失败');
    });

    it('joins title and string detail', () => {
        expect(ToastMessage.toast('读取失败', 'network error')).toBe(
            '读取失败：network error',
        );
    });

    it('formats Error detail', () => {
        expect(ToastMessage.toast('保存失败', new Error('boom'))).toBe('保存失败：boom');
    });
});
