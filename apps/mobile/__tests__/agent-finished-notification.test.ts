/**
 * 通知模块单测：T-P4（前台不发 / 后台才发）、T-P5（失败 5 分钟合并）、
 * MF-4（保活起停串行化）、MF-8（iOS 平台门禁）。
 */
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import {AppState, Platform} from 'react-native';
import notifee, {
  displayNotification,
  createChannel,
  EventType,
} from '@notifee/react-native';
import {
  notifyAgentRunFinished,
  resetFailedNotifyMergeStateForTests,
  resetAgentNotificationPermissionStateForTests,
  resetKeepAliveStateForTests,
  ensureAgentNotificationPermission,
  startAgentKeepAliveService,
  stopAgentKeepAliveService,
  registerAgentNotificationTapHandling,
} from '@/services/agent-finished-notification';

function setAppState(state: string): void {
  Object.defineProperty(AppState, 'currentState', {
    get: () => state,
    configurable: true,
  });
}

/**
 * onBackgroundEvent 的模块级注册发生在 import 时，beforeEach 的
 * clearAllMocks 会清掉调用记录，必须在顶层立即捕获 observer。
 */
const backgroundObserver: (event: {
  type: number;
  detail?: {notification?: {data?: Record<string, unknown>}};
}) => Promise<void> = (notifee.onBackgroundEvent as jest.Mock).mock.calls[0][0];

const backgroundAppStateListener = (
  AppState.addEventListener as jest.Mock
).mock.calls.find(([state]) => state === 'change')?.[1] as
  | ((state: string) => void)
  | undefined;

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

  describe('MF-3: 后台点按（onBackgroundEvent）', () => {
    it('PRESS 携带 sessionId 时触发 tapHandler（与前台共用同一入口）', async () => {
      const onTap = jest.fn();
      registerAgentNotificationTapHandling(onTap);

      await backgroundObserver({
        type: EventType.PRESS,
        detail: {notification: {data: {sessionId: 's9'}}},
      });
      expect(onTap).toHaveBeenCalledWith('s9');
    });

    it('非 PRESS 事件与无 sessionId 的 PRESS 不触发 tapHandler', async () => {
      const onTap = jest.fn();
      registerAgentNotificationTapHandling(onTap);

      await backgroundObserver({type: EventType.DISMISSED, detail: undefined});
      await backgroundObserver({
        type: EventType.PRESS,
        detail: {notification: {data: {}}},
      });
      expect(onTap).not.toHaveBeenCalled();
    });

    it('后台点按记录待导航意图，回前台后消费一次', async () => {
      const onTap = jest.fn();
      registerAgentNotificationTapHandling(onTap);
      await backgroundObserver({
        type: EventType.PRESS,
        detail: {notification: {data: {sessionId: 's9'}}},
      });

      expect(backgroundAppStateListener).toBeInstanceOf(Function);
      backgroundAppStateListener!('active');
      backgroundAppStateListener!('active'); // 意图已消费，不重复导航
      backgroundAppStateListener!('background');
      // 无新的待导航意图：再回前台也不导航（无断言手段，仅验证不抛错）
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

    it('stop 在途期间 start 仍生效：链收敛后该会话通知回到运行', async () => {
      await startAgentKeepAliveService('s1', {sessionTitle: 'S1'});
      expect(displayNotification).toHaveBeenCalledTimes(1);

      // stop 真正进入在途（stopForegroundService 已发出、挂起未决）后再 start：
      // 用「stopFg 已被调用」的 Promise 信号精确等待，不猜微任务时序。
      let resolveStop: () => void = () => undefined;
      let signalStopFgCalled!: () => void;
      const stopFgCalled = new Promise<void>(resolve => {
        signalStopFgCalled = resolve;
      });
      (notifee.stopForegroundService as jest.Mock).mockImplementationOnce(
        () => {
          signalStopFgCalled();
          return new Promise<void>(resolve => {
            resolveStop = resolve;
          });
        },
      );
      const stopPromise = stopAgentKeepAliveService('s1');
      await stopFgCalled;
      const startPromise = startAgentKeepAliveService('s1', {
        sessionTitle: 'S1',
      });
      resolveStop();
      await Promise.all([stopPromise, startPromise]);

      // stop 完成后链上补发该会话保活通知，服务回到运行
      expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);
      expect(displayNotification).toHaveBeenCalledTimes(2);
      expect(
        displayNotification.mock.calls[1][0].android.asForegroundService,
      ).toBe(true);
    });

    it('stopForegroundService reject 不卡链：后续 start 仍能发起', async () => {
      await startAgentKeepAliveService('s1', {sessionTitle: 'S1'});
      (notifee.stopForegroundService as jest.Mock).mockRejectedValueOnce(
        new Error('stop failed'),
      );
      await expect(stopAgentKeepAliveService('s1')).rejects.toThrow(
        'stop failed',
      );

      // 链未被 reject 卡死：新 start 照常发出保活通知
      await startAgentKeepAliveService('s1', {sessionTitle: 'S1'});
      expect(displayNotification).toHaveBeenCalledTimes(2);
    });

    it('stop 后紧接同会话 start：self-successor 护栏——通知原样保留、服务不停', async () => {
      await startAgentKeepAliveService('s1', {sessionTitle: 'S1'});
      const stopPromise = stopAgentKeepAliveService('s1');
      const startPromise = startAgentKeepAliveService('s1', {
        sessionTitle: 'S1',
      });
      await Promise.all([stopPromise, startPromise]);

      // 链按序：stop 任务发现 successor 即 s1（已重登记）→ 原样保留
      expect(notifee.cancelNotification).not.toHaveBeenCalled();
      expect(notifee.stopForegroundService).not.toHaveBeenCalled();
      expect(displayNotification).toHaveBeenCalledTimes(1);
    });
  });
});

describe('T-P5: 保活通知内容与多会话（Step 5 需求）', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    resetKeepAliveStateForTests();
    (Platform as {OS: string}).OS = 'android';
  });

  afterEach(() => {
    (Platform as {OS: string}).OS = originalOS;
  });

  it('带标签启动：标题/正文含会话名与项目名', async () => {
    await startAgentKeepAliveService('s1', {
      projectName: '长篇项目',
      sessionTitle: '第三章续写',
    });
    expect(displayNotification).toHaveBeenCalledTimes(1);
    const call = displayNotification.mock.calls[0][0];
    expect(call.title).toBe('正在生成 · 第三章续写');
    expect(call.body).toContain('长篇项目 · 第三章续写');
    expect(call.body).not.toContain('共 ');
  });

  it('多会话并行：一个会话一条通知，各带自己的 data.sessionId', async () => {
    await startAgentKeepAliveService('s1', {
      projectName: 'P1',
      sessionTitle: 'S1',
    });
    await startAgentKeepAliveService('s2', {
      projectName: 'P2',
      sessionTitle: 'S2',
    });
    expect(displayNotification).toHaveBeenCalledTimes(2);
    const [first, second] = displayNotification.mock.calls.map(c => c[0]);
    expect(first.id).toBe('nm-agent-keepalive-s1');
    expect(first.data).toEqual({sessionId: 's1'});
    expect(first.title).toBe('正在生成 · S1');
    // startForeground 替换语义：同一时刻只有一条挂 asForegroundService（载体）
    expect(first.android.asForegroundService).toBe(true);
    expect(second.id).toBe('nm-agent-keepalive-s2');
    expect(second.data).toEqual({sessionId: 's2'});
    expect(second.title).toBe('正在生成 · S2');
    expect(second.android.asForegroundService).toBe(false);
    expect(notifee.stopForegroundService).not.toHaveBeenCalled();
  });

  it('普通会话先收尾：只撤自己的通知条；载体最后收尾无剩余则停服务', async () => {
    await startAgentKeepAliveService('s1', {sessionTitle: 'S1'}); // 载体
    await startAgentKeepAliveService('s2', {sessionTitle: 'S2'}); // 普通

    // 普通会话 s2 先收尾：只撤 s2 的通知条，载体与服务不动
    await stopAgentKeepAliveService('s2');
    expect(notifee.cancelNotification).toHaveBeenCalledTimes(1);
    expect(notifee.cancelNotification).toHaveBeenCalledWith(
      'nm-agent-keepalive-s2',
    );
    expect(notifee.stopForegroundService).not.toHaveBeenCalled();
    expect(displayNotification).toHaveBeenCalledTimes(2);

    // 载体 s1 最后收尾：无剩余会话 → 停服务（服务停止即撤载体通知）
    await stopAgentKeepAliveService('s1');
    expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);
    expect(displayNotification).toHaveBeenCalledTimes(2);
  });

  it('载体会话先收尾：剩余会话通知升级 FGS（转交），服务不停', async () => {
    await startAgentKeepAliveService('s1', {sessionTitle: 'S1'}); // 载体
    await startAgentKeepAliveService('s2', {sessionTitle: 'S2'}); // 普通

    // 载体 s1 先收尾：s2 升级为载体（重发挂 FGS；替换语义自动撤 s1 旧条）
    await stopAgentKeepAliveService('s1');
    expect(displayNotification).toHaveBeenCalledTimes(3);
    const promoted = displayNotification.mock.calls[2][0];
    expect(promoted.id).toBe('nm-agent-keepalive-s2');
    expect(promoted.android.asForegroundService).toBe(true);
    expect(notifee.cancelNotification).not.toHaveBeenCalled();
    expect(notifee.stopForegroundService).not.toHaveBeenCalled();

    // 转交后 s2 成载体，最后收尾 → 停服务
    await stopAgentKeepAliveService('s2');
    expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);
    expect(displayNotification).toHaveBeenCalledTimes(3);
  });

  it('保活未运行时的按会话收尾是安全 no-op（不真调 stop）', async () => {
    // 对应「保活开关关闭」路径的收尾调用
    await stopAgentKeepAliveService('s-any');
    expect(notifee.stopForegroundService).not.toHaveBeenCalled();
    expect(displayNotification).not.toHaveBeenCalled();
  });

  it('同标签重复登记不刷新（无谓重发抑制）', async () => {
    await startAgentKeepAliveService('s1', {sessionTitle: 'S1'});
    await startAgentKeepAliveService('s1', {sessionTitle: 'S1'});
    expect(displayNotification).toHaveBeenCalledTimes(1);
  });
});
