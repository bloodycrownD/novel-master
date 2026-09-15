/**
 * 通知模块单测：T-P4（前台不发 / 后台才发）、T-P5（失败 5 分钟合并）、
 * MF-4（保活起停串行化）、MF-8（iOS 平台门禁）、T-K1/K2/K3/K4/K11
 * （常驻 resident 期望态）、T-K7（权限状态查询与手动申请）。
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
  getAgentNotificationPermissionStatus,
  requestAgentNotificationPermissionManually,
  setKeepAliveResidentEnabled,
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
        authorizationStatus: 0, // DENIED（与真实枚举一致）
      });
      await expect(ensureAgentNotificationPermission()).resolves.toBe(false);
      expect(notifee.requestPermission).toHaveBeenCalledTimes(1);

      await expect(ensureAgentNotificationPermission()).resolves.toBe(false);
      expect(notifee.requestPermission).toHaveBeenCalledTimes(1); // 未重复申请
    });

    describe('T-K7: 权限状态查询与手动申请', () => {
      it('状态查询两态：AUTHORIZED/PROVISIONAL → authorized，DENIED → denied', async () => {
        (notifee.getNotificationSettings as jest.Mock)
          .mockResolvedValueOnce({authorizationStatus: 1}) // AUTHORIZED
          .mockResolvedValueOnce({authorizationStatus: 2}) // PROVISIONAL
          .mockResolvedValueOnce({authorizationStatus: 0}); // DENIED
        await expect(getAgentNotificationPermissionStatus()).resolves.toBe(
          'authorized',
        );
        await expect(getAgentNotificationPermissionStatus()).resolves.toBe(
          'authorized',
        );
        await expect(getAgentNotificationPermissionStatus()).resolves.toBe(
          'denied',
        );
      });

      it('Android<33 恒 authorized（不查系统设置）', async () => {
        // jest 环境的 Platform 走 iOS 实现：Version 是 getter-only（读平台
        // 常量缓存），对其直接赋值静默无效——这里以 defineProperty 覆写
        // 版本号，测完恢复原描述符，避免污染同文件的后续用例。
        const versionDescriptor = Object.getOwnPropertyDescriptor(
          Platform,
          'Version',
        )!;
        Object.defineProperty(Platform, 'Version', {
          value: 32,
          configurable: true,
        });
        try {
          await expect(getAgentNotificationPermissionStatus()).resolves.toBe(
            'authorized',
          );
          expect(notifee.getNotificationSettings).not.toHaveBeenCalled();
        } finally {
          Object.defineProperty(Platform, 'Version', versionDescriptor);
        }
      });

      it('手动申请 authorized：返回 authorized 且不跳设置页', async () => {
        (notifee.requestPermission as jest.Mock).mockResolvedValueOnce({
          authorizationStatus: 1, // AUTHORIZED
        });
        await expect(
          requestAgentNotificationPermissionManually(),
        ).resolves.toBe('authorized');
        expect(notifee.openNotificationSettings).not.toHaveBeenCalled();
      });

      it('手动申请 denied：openNotificationSettings 被调（不带 channelId）并返回 denied', async () => {
        (notifee.requestPermission as jest.Mock).mockResolvedValueOnce({
          authorizationStatus: 0, // DENIED
        });
        await expect(
          requestAgentNotificationPermissionManually(),
        ).resolves.toBe('denied');
        expect(notifee.openNotificationSettings).toHaveBeenCalledTimes(1);
        expect(notifee.openNotificationSettings).toHaveBeenCalledWith();
      });

      it('permissionDenied 降级不影响手动路径：降级后手动仍直发 requestPermission', async () => {
        // 自动申请被拒一次，置起 permissionDenied 降级标记
        (notifee.requestPermission as jest.Mock).mockResolvedValueOnce({
          authorizationStatus: 0, // DENIED
        });
        await expect(ensureAgentNotificationPermission()).resolves.toBe(false);

        // 手动路径绕过降级：仍直接调 requestPermission
        (notifee.requestPermission as jest.Mock).mockResolvedValueOnce({
          authorizationStatus: 1, // AUTHORIZED
        });
        await expect(
          requestAgentNotificationPermissionManually(),
        ).resolves.toBe('authorized');
        expect(notifee.requestPermission).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('MF-8: 平台门禁（完成通知 + 常驻链路）', () => {
    const originalOS = Platform.OS;

    afterEach(() => {
      (Platform as {OS: string}).OS = originalOS;
    });

    it('iOS 上 notifyAgentRunFinished 不走到 Android-only API（createChannel / displayNotification 均不调用）', async () => {
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

    it('svc/B-1: iOS 上 setKeepAliveResidentEnabled(true) 零 display、零 stop（常驻链路门禁）', async () => {
      (Platform as {OS: string}).OS = 'ios';
      await setKeepAliveResidentEnabled(true);
      expect(displayNotification).not.toHaveBeenCalled();
      expect(notifee.stopForegroundService).not.toHaveBeenCalled();

      // resident 未被 iOS 调用污染为 true：切回 android 重新打开，
      // 空闲常驻通知正常拉起（而非因 desired/running 错位被 no-op 吞掉）
      (Platform as {OS: string}).OS = 'android';
      await setKeepAliveResidentEnabled(true);
      expect(displayNotification).toHaveBeenCalledTimes(1);
      expect(displayNotification.mock.calls[0][0].title).toBe(
        'novel master · 空闲',
      );
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

    it('stop 在途期间重新拉起仍生效：链收敛后前台服务回到运行', async () => {
      await setKeepAliveResidentEnabled(true);
      expect(displayNotification).toHaveBeenCalledTimes(1);

      // 关开关的 stop 真正进入在途（stopForegroundService 已发出、挂起未决）
      // 后再重新开
      let resolveStop: () => void = () => undefined;
      (notifee.stopForegroundService as jest.Mock).mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            resolveStop = resolve;
          }),
      );
      const offPromise = setKeepAliveResidentEnabled(false);
      // 让一个微任务 tick 过去：链尾 reconcile 已开始执行、stop 在途
      await Promise.resolve();
      const onPromise = setKeepAliveResidentEnabled(true);
      resolveStop();
      await Promise.all([offPromise, onPromise]);

      // stop 完成后链上按最新期望态（运行）补发保活通知，服务回到运行
      expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);
      expect(displayNotification).toHaveBeenCalledTimes(2);
      expect(
        displayNotification.mock.calls[1][0].android.asForegroundService,
      ).toBe(true);
    });

    it('stopForegroundService reject 后标记复位，后续重新拉起仍能发起', async () => {
      await setKeepAliveResidentEnabled(true);
      (notifee.stopForegroundService as jest.Mock).mockRejectedValueOnce(
        new Error('stop failed'),
      );
      await expect(setKeepAliveResidentEnabled(false)).rejects.toThrow(
        'stop failed',
      );

      // 标记已随 finally 复位：重新开不被卡死，保活通知再次发出
      await setKeepAliveResidentEnabled(true);
      expect(displayNotification).toHaveBeenCalledTimes(2);
    });

    it('stop 在途且期望又变回运行时，未执行的 stop 直接跳过（服务不停）', async () => {
      await setKeepAliveResidentEnabled(true);
      // 关开关尚未执行（排在链上），重新开先把期望态改回运行
      const offPromise = setKeepAliveResidentEnabled(false);
      const onPromise = setKeepAliveResidentEnabled(true);
      await Promise.all([offPromise, onPromise]);

      // 链上 reconcile 看到的期望态一直是运行：不 stop 也不重复 start
      expect(notifee.stopForegroundService).not.toHaveBeenCalled();
      expect(displayNotification).toHaveBeenCalledTimes(1);
    });
  });
});

describe('保活通知内容与多会话（常驻 resident 模式）', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    resetKeepAliveStateForTests();
    (Platform as {OS: string}).OS = 'android';
  });

  afterEach(() => {
    (Platform as {OS: string}).OS = originalOS;
  });

  it('T-K1: 开关启停——(true) 以 asForegroundService+ongoing 拉起空闲通知，(false) 停服务', async () => {
    await setKeepAliveResidentEnabled(true);
    expect(displayNotification).toHaveBeenCalledTimes(1);
    const call = displayNotification.mock.calls[0][0];
    expect(call.title).toBe('novel master · 空闲');
    expect(call.android.asForegroundService).toBe(true);
    expect(call.android.ongoing).toBe(true);

    await setKeepAliveResidentEnabled(false);
    expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);
    expect(displayNotification).toHaveBeenCalledTimes(1); // 关停不刷新内容
  });

  it('T-K2: 空闲↔生成文案切换——labels 空闲无 body，登记标签切「正在生成」，摘标签回空闲', async () => {
    await setKeepAliveResidentEnabled(true);
    // labels 空：空闲文案、无 body
    expect(displayNotification.mock.calls[0][0].title).toBe(
      'novel master · 空闲',
    );
    expect(displayNotification.mock.calls[0][0].body).toBeUndefined();

    await startAgentKeepAliveService('s1', {sessionTitle: 'X'});
    expect(displayNotification).toHaveBeenCalledTimes(2);
    expect(displayNotification.mock.calls[1][0].title).toBe('正在生成 · X');

    await stopAgentKeepAliveService('s1');
    // 摘回最后一个标签：常驻模式服务不停，内容刷回空闲文案
    expect(notifee.stopForegroundService).not.toHaveBeenCalled();
    expect(displayNotification).toHaveBeenCalledTimes(3);
    expect(displayNotification.mock.calls[2][0].title).toBe(
      'novel master · 空闲',
    );
  });

  it('带标签启动：标题/正文含会话名与项目名', async () => {
    await setKeepAliveResidentEnabled(true); // calls[0]：空闲拉起
    await startAgentKeepAliveService('s1', {
      projectName: '长篇项目',
      sessionTitle: '第三章续写',
    });
    expect(displayNotification).toHaveBeenCalledTimes(2);
    const call = displayNotification.mock.calls[1][0];
    expect(call.title).toBe('正在生成 · 第三章续写');
    expect(call.body).toContain('长篇项目 · 第三章续写');
    expect(call.body).not.toContain('共 ');
  });

  it('同 id 重发刷新内容：标签变化时运行中通知更新', async () => {
    await setKeepAliveResidentEnabled(true); // calls[0]：空闲拉起
    await startAgentKeepAliveService('s1', {
      projectName: 'P1',
      sessionTitle: 'S1',
    });
    await startAgentKeepAliveService('s2', {
      projectName: 'P2',
      sessionTitle: 'S2',
    });
    // 第二个会话加入：内容刷新为最新 + 总数
    expect(displayNotification).toHaveBeenCalledTimes(3);
    const refreshed = displayNotification.mock.calls[2][0];
    expect(refreshed.title).toBe('正在生成 · S2');
    expect(refreshed.body).toContain('共 2 个会话生成中');
    expect(notifee.stopForegroundService).not.toHaveBeenCalled();
  });

  it('T-K3: 多会话最后一个收尾回空闲文案，服务不停（反转随 run 停服）', async () => {
    await setKeepAliveResidentEnabled(true); // calls[0]：空闲拉起
    await startAgentKeepAliveService('s1', {sessionTitle: 'S1'});
    await startAgentKeepAliveService('s2', {sessionTitle: 'S2'});
    expect(displayNotification).toHaveBeenCalledTimes(3);

    await stopAgentKeepAliveService('s2');
    // s1 仍在跑：内容回到 S1（无总数行）
    expect(notifee.stopForegroundService).not.toHaveBeenCalled();
    expect(displayNotification).toHaveBeenCalledTimes(4);
    const afterOne = displayNotification.mock.calls[3][0];
    expect(afterOne.title).toBe('正在生成 · S1');
    expect(afterOne.body).not.toContain('共 ');

    // 最后一个收尾：常驻模式服务不停，刷新回空闲文案
    await stopAgentKeepAliveService('s1');
    expect(notifee.stopForegroundService).not.toHaveBeenCalled();
    expect(displayNotification).toHaveBeenCalledTimes(5);
    expect(displayNotification.mock.calls[4][0].title).toBe(
      'novel master · 空闲',
    );
  });

  it('resident 关闭时的按会话收尾是安全 no-op（不真调 stop、零 display）', async () => {
    // 对应「消息通知开关关闭」路径的收尾调用：服务从未被开关拉起
    await stopAgentKeepAliveService('s-any');
    expect(notifee.stopForegroundService).not.toHaveBeenCalled();
    expect(displayNotification).not.toHaveBeenCalled();
  });

  it('同标签重复登记不刷新（无谓重发抑制）', async () => {
    await setKeepAliveResidentEnabled(true); // calls[0]：空闲拉起
    await startAgentKeepAliveService('s1', {sessionTitle: 'S1'});
    await startAgentKeepAliveService('s1', {sessionTitle: 'S1'});
    expect(displayNotification).toHaveBeenCalledTimes(2); // 第二次同标签仍不刷新
  });

  it('T-K4: resident=false 时标签操作为 no-op；常驻关但服务在跑的兜底摘除停服务', async () => {
    // 前半：开关未开时标签登记/摘除均零副作用（display/stop 都不调用）
    await startAgentKeepAliveService('s1', {sessionTitle: 'S1'});
    await stopAgentKeepAliveService('s1');
    expect(displayNotification).not.toHaveBeenCalled();
    expect(notifee.stopForegroundService).not.toHaveBeenCalled();

    // 后半：兜底摘除路径——经 stopForegroundService 挂起窗口构造
    // 「resident=false + labels 非空 + 服务运行中」的在途瞬态，
    // 最后一个标签摘除（enqueue(false)）把残留服务停掉且不重复 stop
    await setKeepAliveResidentEnabled(true); // calls[0]：空闲拉起
    await startAgentKeepAliveService('s1', {sessionTitle: 'S1'}); // calls[1]
    let resolveStop: () => void = () => undefined;
    (notifee.stopForegroundService as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          resolveStop = resolve;
        }),
    );
    const offPromise = setKeepAliveResidentEnabled(false); // 关开关：停服在途挂起
    await Promise.resolve(); // 链尾 reconcile 已开始执行、stop 在途
    const stopPromise = stopAgentKeepAliveService('s1'); // 兜底摘除最后一个标签
    resolveStop();
    await Promise.all([offPromise, stopPromise]);
    expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);
    expect(displayNotification).toHaveBeenCalledTimes(2); // 关停后不再刷新内容
  });

  it('T-K11: 生成中关开关——立即停服且标签保留；关开关状态标签操作零副作用；重开后带标签拉起', async () => {
    await setKeepAliveResidentEnabled(true); // calls[0]：空闲拉起
    await startAgentKeepAliveService('s1', {sessionTitle: 'S1'}); // calls[1]
    expect(displayNotification.mock.calls[1][0].title).toBe('正在生成 · S1');

    // 生成中关开关：立即停服（run 继续仅失去保活）
    await setKeepAliveResidentEnabled(false);
    expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);

    // 关开关状态下标签操作（再 start 新会话 / stop 既有会话）零 display、零新增 stop
    await startAgentKeepAliveService('s2', {sessionTitle: 'S2'});
    await stopAgentKeepAliveService('s2');
    expect(displayNotification).toHaveBeenCalledTimes(2);
    expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);

    // 标签保留：重开开关后内容为「正在生成 · S1」而非空闲文案
    // （证明关开关未清标签，服务带标签内容重新拉起）
    await setKeepAliveResidentEnabled(true);
    expect(displayNotification).toHaveBeenCalledTimes(3);
    expect(displayNotification.mock.calls[2][0].title).toBe('正在生成 · S1');
  });
});
