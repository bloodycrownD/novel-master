/**
 * 常驻保活启动挂点与通知偏好桥工厂直测（T-K8/T-K9，Step 3 落点）：
 * - T-K8：ensureKeepAliveResidentBoot——appUi 开关开 → 经全局 notifee mock
 *   观察常驻空闲通知拉起；开关关 / appUi 为 undefined → 零拉起。
 * - T-K9：createNotificationPrefBridge——getAppUi() 未就绪时降级口径为
 *   false（与开关默认关对齐）；返回正常 appUi → 按存储值真读。
 */
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import notifee from '@notifee/react-native';
import {
  ensureKeepAliveResidentBoot,
  createNotificationPrefBridge,
} from '@/runtime/novel-master-context';
import {resetKeepAliveStateForTests} from '@/services/agent-finished-notification';
import type {AppUiPreferences} from '@/storage/app-ui-prefs';

/** 内存 KKV 形状的 appUi（照 message-notification-pref.test.ts 的模式）。 */
function appUiWith(raw: Record<string, string | undefined>): AppUiPreferences {
  return {
    get: jest.fn(async (key: string) => raw[key]),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    listKeys: jest.fn(async () => []),
  };
}

describe('keepalive-resident-boot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetKeepAliveStateForTests();
  });

  afterEach(() => {
    // 退出前复位保活模块级状态，防 resident 态泄漏到其它测试文件。
    resetKeepAliveStateForTests();
  });

  describe('T-K8 ensureKeepAliveResidentBoot', () => {
    it('开关开：拉起常驻空闲通知（asForegroundService + ongoing）', async () => {
      const appUi = appUiWith({messageNotification: 'true'});
      await ensureKeepAliveResidentBoot(appUi);
      expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
      expect(notifee.displayNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'nm-agent-keepalive',
          title: 'novel master · 空闲',
          android: expect.objectContaining({
            asForegroundService: true,
            ongoing: true,
          }),
        }),
      );
    });

    it('开关关：零拉起', async () => {
      const appUi = appUiWith({messageNotification: 'false'});
      await ensureKeepAliveResidentBoot(appUi);
      expect(notifee.displayNotification).not.toHaveBeenCalled();
      expect(notifee.stopForegroundService).not.toHaveBeenCalled();
    });

    it('appUi 未就绪（undefined）：守卫分支直接返回，不抛错零拉起', async () => {
      await expect(
        ensureKeepAliveResidentBoot(undefined),
      ).resolves.toBeUndefined();
      expect(notifee.displayNotification).not.toHaveBeenCalled();
      expect(notifee.stopForegroundService).not.toHaveBeenCalled();
    });
  });

  describe('T-K9 createNotificationPrefBridge', () => {
    it('getAppUi 未就绪：降级口径为 false', async () => {
      const bridge = createNotificationPrefBridge(() => undefined);
      await expect(bridge.isNotificationEnabled()).resolves.toBe(false);
    });

    it('appUi 就绪：按存储值读取（开 → true，关 → false）', async () => {
      const on = createNotificationPrefBridge(() =>
        appUiWith({messageNotification: 'true'}),
      );
      await expect(on.isNotificationEnabled()).resolves.toBe(true);
      const off = createNotificationPrefBridge(() =>
        appUiWith({messageNotification: 'false'}),
      );
      await expect(off.isNotificationEnabled()).resolves.toBe(false);
    });
  });
});
