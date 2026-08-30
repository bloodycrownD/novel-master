/**
 * 通知模块单测：T-P4（前台不发 / 后台才发）、T-P5（失败 5 分钟合并）。
 */
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import {AppState, Platform} from 'react-native';
import notifee, {displayNotification} from '@notifee/react-native';
import {
  notifyAgentRunFinished,
  resetFailedNotifyMergeStateForTests,
  resetAgentNotificationPermissionStateForTests,
  ensureAgentNotificationPermission,
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
  });

  describe('T-P4: 通知触发条件', () => {
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
    beforeEach(() => {
      setAppState('background');
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
});
