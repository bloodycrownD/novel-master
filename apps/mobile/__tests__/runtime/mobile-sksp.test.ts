jest.mock('react-native', () => ({Platform: {OS: 'ios'}}));

import {MobileSksp} from '@/runtime/mobile-sksp';

describe('mobileSkspDriverName', () => {
    it('android 直传返回 android', () => {
        expect(MobileSksp.driverName('android')).toBe('android');
    });

    it('非 android 平台抛含平台名的可读中文错误', () => {
        expect(() => MobileSksp.driverName()).toThrow('ios');
        expect(() => MobileSksp.driverName()).toThrow('暂不支持加密存储驱动');
        expect(() => MobileSksp.driverName('web')).toThrow('web');
    });
});
