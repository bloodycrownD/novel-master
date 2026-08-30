/**
 * 通知模块单测：T-P4（前台不发 / 后台才发）、T-P5（失败 5 分钟合并）、
 * MF-4（保活起停串行化）、MF-8（iOS 平台门禁）。
 */
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import {AppState, Platform} from 'react-native';
import notifee, {displayNotification, createChannel} from '@notifee/react-native';
import {
  notifyAgentRunFinished,
  resetFailedNotifyMergeStateForTests,
  resetAgentNotificationPermissionStateForTests,
  resetKeepAliveStateForTests,
  ensureAgentNotificationPermission,
  startAgentKeepAliveService,
  stopAgentKeepAliveService,
} from '@/services/agent-finished-notification';

function setAppState(state: string): void {
  Object.defineProperty(AppState, 'currentState', {
    get: () => state,
    configurable: true,
  });
}

describe('agent-finished-notification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetFailedNotifyMergeStateForTests();
    resetAgentNotificationPermissionStateForTests();
    resetKeepAliveStateForTests();
  });

  describe('T-P4: 通知触发条件', () => {
    const originalOS = Platform.OS;

    beforeEach(() => {
      (Platform as {OS: string}).OS = 'android';
    });

    afterEach(() => {
      (Platform as {OS: string}).OS = originalOS;
    });

    it('app 在后台 + run 成功 → 发完成通知', async () => {
      setAppState('background');
      await notifyAgentRunFinished({
        sessionId: 's1',
        sessionTitle: '会话一',
        status: 'finished',
      });
      expect(displayNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '生成完成',
          data: {sessionId: 's1'},
        }),
      );
    });

    it('app 在前台（任意页面，含停留生成中会话）→ 不发', async () => {
      setAppState('active');
      await notifyAgentRunFinished({
        sessionId: 's1',
        sessionTitle: '会话一',
        status: 'finished',
      });
      await notifyAgentRunFinished({
        sessionId: 's1',
        sessionTitle: '会话一',
        status: 'failed',
      });
      expect(displayNotification).not.toHaveBeenCalled();
    });

    it('app 在后台 + run 失败 → 发失败通知', async () => {
      setAppState('background');
      await notifyAgentRunFinished({
        sessionId: 's1',
        sessionTitle: '会话一',
        status: 'failed',
      });
      expect(displayNotification).toHaveBeenCalledWith(
        expect.objectContaining({title: '生成失败'}),
      );
    });
  });

  describe('T-P5: 失败 5 分钟合并', () => {
    const originalOS = Platform.OS;

    beforeEach(() => {
      setAppState('background');
      (Platform as {OS: string}).OS = 'android';
    });

    afterEach(() => {
      (Platform as {OS: string}).OS = originalOS;
    });

    it('同会话 5 分钟内多次失败只发一条', async () => {
      await notifyAgentRunFinished({
        sessionId: 's1',
        sessionTitle: undefined,
        status: 'failed',
      });
      await notifyAgentRunFinished({
        sessionId: 's1',
        sessionTitle: undefined,
        status: 'failed',
      });
      expect(displayNotification).toHaveBeenCalledTimes(1);
    });

    it('不同会话的失败互不合并', async () => {
      await notifyAgentRunFinished({
        sessionId: 's1',
        sessionTitle: undefined,
        status: 'failed',
      });
      await notifyAgentRunFinished({
        sessionId: 's2',
        sessionTitle: undefined,
        status: 'failed',
      });
      expect(displayNotification).toHaveBeenCalledTimes(2);
    });

    it('超过 5 分钟窗口后同会话失败再次发送', async () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      await notifyAgentRunFinished({
        sessionId: 's1',
        sessionTitle: undefined,
        status: 'failed',
      });
      nowSpy.mockReturnValue(1_000_000 + 5 * 60 * 1000 + 1);
      await notifyAgentRunFinished({
        sessionId: 's1',
        sessionTitle: undefined,
        status: 'failed',
      });
      expect(displayNotification).toHaveBeenCalledTimes(2);
      nowSpy.mockRestore();
    });

    it('成功通知不占用失败合并窗口', async () => {
      await notifyAgentRunFinished({
        sessionId: 's1',
        sessionTitle: undefined,
        status: 'failed',
      });
      await notifyAgentRunFinished({
        sessionId: 's1',
        sessionTitle: undefined,
        status: 'finished',
      });
      expect(displayNotification).toHaveBeenCalledTimes(2);
    });
  });

  describe('权限申请', () => {
    const originalOS = Platform.OS;
    const originalVersion = (Platform as {Version?: number}).Version;

    beforeEach(() => {
      (Platform as {OS: string}).OS = 'android';
      (Platform as {Version?: number}).Version = 34;
    });

    afterEach(() => {
      (Platform as {OS: string}).OS = originalOS;
      (Platform as {Version?: number}).Version = originalVersion;
    });

    it('授权后返回 true', async () => {
      (notifee.requestPermission as jest.Mock).mockResolvedValueOnce({
        authorizationStatus: 1, // AUTHORIZED
      });
      await expect(ensureAgentNotificationPermission()).resolves.toBe(true);
    });

    it('拒绝后降级：返回 false 且后续不再申请', async () => {
      (notifee.requestPermission as jest.Mock).mockResolvedValueOnce({
        authorizationStatus: 4, // DENIED
      });
      await expect(ensureAgentNotificationPermission()).resolves.toBe(false);
      expect(notifee.requestPermission).toHaveBeenCalledTimes(1);

      await expect(ensureAgentNotificationPermission()).resolves.toBe(false);
      expect(notifee.requestPermission).toHaveBeenCalledTimes(1); // 未重复申请
    });
  });

  describe('MF-8: notifyAgentRunFinished 平台门禁', () => {
    const originalOS = Platform.OS;

    afterEach(() => {
      (Platform as {OS: string}).OS = originalOS;
    });

    it('iOS 上不走到 Android-only API（createChannel / displayNotification 均不调用）', async () => {
      (Platform as {OS: string}).OS = 'ios';
      setAppState('background');
      await notifyAgentRunFinished({
        sessionId: 's1',
        sessionTitle: '会话一',
        status: 'failed',
      });
      expect(displayNotification).not.toHaveBeenCalled();
      expect(createChannel).not.toHaveBeenCalled();
    });

    it('iOS 调用不消耗失败合并窗口：切回 android 后同会话失败仍发通知', async () => {
      (Platform as {OS: string}).OS = 'ios';
      setAppState('background');
      await notifyAgentRunFinished({
        sessionId: 's1',
        sessionTitle: undefined,
        status: 'failed',
      });
      (Platform as {OS: string}).OS = 'android';
      await notifyAgentRunFinished({
        sessionId: 's1',
        sessionTitle: undefined,
        status: 'failed',
      });
      expect(displayNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe('MF-4: 保活起停串行化', () => {
    const originalOS = Platform.OS;

    beforeEach(() => {
      (Platform as {OS: string}).OS = 'android';
    });

    afterEach(() => {
      (Platform as {OS: string}).OS = originalOS;
    });

    it('stop 在途期间 start 仍生效：链收敛后前台服务回到运行', async () => {
      await startAgentKeepAliveService();
      expect(displayNotification).toHaveBeenCalledTimes(1);

      // stop 真正进入在途（stopForegroundService 已发出、挂起未决）后再 start
      let resolveStop: () => void = () => undefined;
      (notifee.stopForegroundService as jest.Mock).mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            resolveStop = resolve;
          }),
      );
      const stopPromise = stopAgentKeepAliveService();
      // 让一个微任务 tick 过去：链尾 reconcile 已开始执行、stop 在途
      await Promise.resolve();
      const startPromise = startAgentKeepAliveService();
      resolveStop();
      await Promise.all([stopPromise, startPromise]);

      // stop 完成后链上按最新期望态（运行）补发保活通知，服务回到运行
      expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);
      expect(displayNotification).toHaveBeenCalledTimes(2);
      expect(
        displayNotification.mock.calls[1][0].android.asForegroundService,
      ).toBe(true);
    });

    it('stopForegroundService reject 后标记复位，后续 start 仍能发起', async () => {
      await startAgentKeepAliveService();
      (notifee.stopForegroundService as jest.Mock).mockRejectedValueOnce(
        new Error('stop failed'),
      );
      await expect(stopAgentKeepAliveService()).rejects.toThrow('stop failed');

      // 标记已随 finally 复位：新 start 不被卡死，保活通知再次发出
      await startAgentKeepAliveService();
      expect(displayNotification).toHaveBeenCalledTimes(2);
    });

    it('stop 在途且期望又变回运行时，未执行的 stop 直接跳过（服务不停）', async () => {
      await startAgentKeepAliveService();
      // stop 尚未执行（排在链上），start 先把期望态改回运行
      const stopPromise = stopAgentKeepAliveService();
      const startPromise = startAgentKeepAliveService();
      await Promise.all([stopPromise, startPromise]);

      // 链上 reconcile 看到的期望态一直是运行：不 stop 也不重复 start
      expect(notifee.stopForegroundService).not.toHaveBeenCalled();
      expect(displayNotification).toHaveBeenCalledTimes(1);
    });
  });
});
