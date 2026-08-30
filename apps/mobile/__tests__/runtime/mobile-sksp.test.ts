jest.mock('react-native', () => ({Platform: {OS: 'ios'}}));

import {mobileSkspDriverName} from '@/runtime/mobile-sksp';

describe('mobileSkspDriverName', () => {
  it('android 直传返回 android', () => {
    expect(mobileSkspDriverName('android')).toBe('android');
  });

  it('非 android 平台抛含平台名的可读中文错误', () => {
    expect(() => mobileSkspDriverName()).toThrow('ios');
    expect(() => mobileSkspDriverName()).toThrow('暂不支持加密存储驱动');
    expect(() => mobileSkspDriverName('web')).toThrow('web');
  });
});
