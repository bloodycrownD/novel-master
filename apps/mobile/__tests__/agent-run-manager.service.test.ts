/**
 * AgentRunManager 单元测试（mock runtime 范式）。
 *
 * 覆盖：T-P1（跨会话并行互不串扰）、T-P2（单会话串行两信号拒绝）、
 * T-P3（切走会话后 FINISHED 仍 decrement——修 refcount 泄漏）、
 * T-P9（RUN_STARTED 未达即抛错的 finally 早退兜底）、dispose 清零、
 * T-P6（偏好关闭后完成通知不发、保活照常）。
 */
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  SimpleEventBus,
} from '@novel-master/core/events';
import {
  isMobileAgentActive,
  setMobileAgentActive,
} from '@/runtime/agent-activity';
import {AgentRunManager} from '@/services/agent-run-manager.service';
import {Platform} from 'react-native';
import notifee, {onForegroundEventUnsubscribe} from '@notifee/react-native';

/** 等待 fire-and-forget promise 链（catch+finally）收敛。 */
async function flushAsync(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

function createHarness() {
  const eventBus = new SimpleEventBus();
  const abortRegistry = {
    has: jest.fn((_sessionId: string) => false),
    abort: jest.fn(),
    register: jest.fn(),
    unregister: jest.fn(),
  };
  const sessions = {
    get: jest.fn(async (sessionId: string) => ({
      id: sessionId,
      title: `会话-${sessionId}`,
    })),
  };
  const projects = {
    get: jest.fn(async (projectId: string) => ({
      id: projectId,
      name: `项目-${projectId}`,
    })),
  };
  const runAgentTurn = jest.fn(
    async (_runtime: unknown, _scope: unknown, _content: string) => undefined,
  );
  const manager = new AgentRunManager({
    runtime: {eventBus, abortRegistry, sessions, projects} as never,
    runAgentTurn: runAgentTurn as never,
  });
  return {eventBus, abortRegistry, sessions, projects, runAgentTurn, manager};
}

function publishStarted(
  eventBus: SimpleEventBus,
  sessionId: string,
  runId: string,
): void {
  eventBus.publish(EVENT_AGENT_RUN_STARTED, {
    sessionId,
    projectId: 'p',
    runId,
  });
}

function publishFinished(
  eventBus: SimpleEventBus,
  sessionId: string,
  runId: string,
): void {
  eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
    sessionId,
    projectId: 'p',
    runId,
    stopReason: 'done',
  });
}

function publishFailed(
  eventBus: SimpleEventBus,
  sessionId: string,
  runId: string,
): void {
  eventBus.publish(EVENT_AGENT_RUN_FAILED, {
    sessionId,
    projectId: 'p',
    runId,
    error: 'model error',
  });
}

describe('AgentRunManager', () => {
  beforeEach(() => {
    setMobileAgentActive(false);
    jest.clearAllMocks();
  });

  afterEach(() => {
    setMobileAgentActive(false);
  });

  it('T-P3d: getEntry 投影随生命周期迁移（starting→running→null），subscribeEntries 逐点通知', async () => {
    const h = createHarness();
    h.runAgentTurn.mockImplementation(
      () => new Promise<undefined>(() => undefined),
    );
    const events: string[] = [];
    const unsubscribe = h.manager.subscribeEntries(() => events.push('notify'));

    // 受理 → starting（runId 未知）
    const started = h.manager.startRun('s1', 'p', 'hi');
    expect(started.ok).toBe(true);
    expect(h.manager.getEntry('s1')).toEqual({status: 'starting', runId: null});
    expect(h.manager.hasRun('s1')).toBe(true);
    expect(events).toHaveLength(1);

    // RUN_STARTED → running + runId 回填
    publishStarted(h.eventBus, 's1', 'r1');
    expect(h.manager.getEntry('s1')).toEqual({status: 'running', runId: 'r1'});
    expect(events).toHaveLength(2);

    // FINISHED → 投影清空
    publishFinished(h.eventBus, 's1', 'r1');
    expect(h.manager.getEntry('s1')).toBe(null);
    expect(h.manager.hasRun('s1')).toBe(false);
    expect(events).toHaveLength(3);

    // 退订后不再通知
    unsubscribe();
    h.manager.startRun('s2', 'p', 'again');
    expect(events).toHaveLength(3);
    expect(h.manager.getEntry('s2')).toEqual({status: 'starting', runId: null});
  });

  it('T-P1: session A run 进行中 startRun(B) 正常受理，事件与状态互不串扰', () => {
    const h = createHarness();
    const settledA = jest.fn();
    const settledB = jest.fn();

    expect(h.manager.startRun('a', 'p', 'hi', {onSettled: settledA})).toEqual({
      ok: true,
    });
    publishStarted(h.eventBus, 'a', 'r1');
    expect(h.manager.hasRun('a')).toBe(true);

    // A 活跃期间 B 受理（旧全局单 run 模式会拦截）
    expect(h.manager.startRun('b', 'p', 'yo', {onSettled: settledB})).toEqual({
      ok: true,
    });
    publishStarted(h.eventBus, 'b', 'r2');
    expect(isMobileAgentActive()).toBe(true);

    // A 结束不影响 B
    publishFinished(h.eventBus, 'a', 'r1');
    expect(settledA).toHaveBeenCalledWith('finished');
    expect(settledB).not.toHaveBeenCalled();
    expect(h.manager.hasRun('a')).toBe(false);
    expect(h.manager.hasRun('b')).toBe(true);
    expect(isMobileAgentActive()).toBe(true);

    publishFinished(h.eventBus, 'b', 'r2');
    expect(settledB).toHaveBeenCalledWith('finished');
    expect(isMobileAgentActive()).toBe(false);
  });

  it('T-P2: abortRegistry.has 为 true 时 startRun 被拒并返回明确错误', () => {
    const h = createHarness();
    h.abortRegistry.has.mockImplementation(sid => sid === 'a');

    const result = h.manager.startRun('a', 'p', 'hi');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
    expect(h.runAgentTurn).not.toHaveBeenCalled();
    expect(isMobileAgentActive()).toBe(false);
  });

  it('T-P2: entry 处 starting（RUN_STARTED 未达、registry 未注册）时二次 startRun 同样被拒', () => {
    const h = createHarness();
    // registry 尚未 register（受理→register 的异步空窗）
    h.abortRegistry.has.mockReturnValue(false);

    expect(h.manager.startRun('a', 'p', 'first').ok).toBe(true);
    // 空窗内第二个同会话 run 必须被 entry 的 starting 状态拦住
    const second = h.manager.startRun('a', 'p', 'second');
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.length).toBeGreaterThan(0);
    }
    expect(h.runAgentTurn).toHaveBeenCalledTimes(1);
    expect(isMobileAgentActive()).toBe(true); // 单个受理计数
  });

  it('T-P3: 切走会话后（无 UI 面板消费）FINISHED 仍正确 decrement，全局不卡死', () => {
    const h = createHarness();
    expect(h.manager.startRun('a', 'p', 'hi').ok).toBe(true);
    publishStarted(h.eventBus, 'a', 'r1');
    expect(isMobileAgentActive()).toBe(true);

    // 无任何 UI 面板订阅过滤——Manager 全量事件直接收尾
    publishFinished(h.eventBus, 'a', 'r1');
    expect(isMobileAgentActive()).toBe(false);
    expect(h.manager.hasRun('a')).toBe(false);
  });

  it('RUN_STARTED 只迁移 entry 状态不碰 refcount；FAILED 走 decrement + onSettled(failed)', () => {
    const h = createHarness();
    const settled = jest.fn();
    h.manager.startRun('a', 'p', 'hi', {onSettled: settled});

    publishStarted(h.eventBus, 'a', 'r1');
    expect(isMobileAgentActive()).toBe(true); // increment 只在受理路径

    publishFailed(h.eventBus, 'a', 'r1');
    expect(settled).toHaveBeenCalledWith('failed');
    expect(isMobileAgentActive()).toBe(false);
  });

  it('T-P9: startRun 后未收到 RUN_STARTED 即抛错 → finally 清 entry 并 decrement，refcount 回落', async () => {
    const h = createHarness();
    h.runAgentTurn.mockRejectedValue(new Error('early boom'));

    expect(h.manager.startRun('a', 'p', 'hi').ok).toBe(true);
    expect(isMobileAgentActive()).toBe(true); // 受理路径已同步 increment

    await flushAsync();
    expect(isMobileAgentActive()).toBe(false); // finally 兜底回落
    expect(h.manager.hasRun('a')).toBe(false);

    // 后续 run 不被卡死（refcount 已回落即可重新受理）
    h.runAgentTurn.mockResolvedValue(undefined);
    expect(h.manager.startRun('a', 'p', 'again').ok).toBe(true);
    await flushAsync();
  });

  it('T-P9 变体: RUN_STARTED 已达时 finally 提前 return 不双减（事件路径负责收尾）', async () => {
    const h = createHarness();
    h.runAgentTurn.mockRejectedValue(new Error('late boom'));

    h.manager.startRun('a', 'p', 'hi');
    publishStarted(h.eventBus, 'a', 'r1');
    publishFinished(h.eventBus, 'a', 'r1'); // 事件路径已 decrement
    expect(isMobileAgentActive()).toBe(false);

    await flushAsync();
    expect(isMobileAgentActive()).toBe(false); // finally 未把计数减成负
  });

  it('RUN_STARTED 后失败只弹一次 toast（事件路径已收尾，throw 路径不重复弹）', async () => {
    const h = createHarness();
    // core 失败形状：publish EVENT_AGENT_RUN_FAILED 后同一次 throw
    h.runAgentTurn.mockRejectedValue(new Error('late boom'));
    const onError = jest.fn();
    h.manager.setUiBridge({onError});

    h.manager.startRun('a', 'p', 'hi');
    publishStarted(h.eventBus, 'a', 'r1');
    publishFailed(h.eventBus, 'a', 'r1'); // 事件路径：onError + 收尾
    await flushAsync(); // throw 路径随后到达

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('model error');
    expect(isMobileAgentActive()).toBe(false);
  });

  it('RUN_STARTED 未达即抛错（resolve/register 阶段）时 throw 路径兑底弹一次 toast', async () => {
    const h = createHarness();
    h.runAgentTurn.mockRejectedValue(new Error('early boom'));
    const onError = jest.fn();
    h.manager.setUiBridge({onError});

    h.manager.startRun('a', 'p', 'hi');
    await flushAsync();

    // FAILED 事件永远不会来，只由 throw 路径弹
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('early boom');
  });

  it('MF-1: 无 entry 的 FAILED 事件不弹 toast（subagent 子 run / 旧连接残留不误报）', () => {
    const h = createHarness();
    const onError = jest.fn();
    h.manager.setUiBridge({onError});

    publishFailed(h.eventBus, 'other', 'r-x'); // 无 entry 的会话
    expect(onError).not.toHaveBeenCalled();
  });

  it('MF-1: runId 不匹配的 FAILED 事件不弹 toast，且不影响在途 run', () => {
    const h = createHarness();
    const onError = jest.fn();
    h.manager.setUiBridge({onError});

    h.manager.startRun('a', 'p', 'hi');
    publishStarted(h.eventBus, 'a', 'r1');
    publishFailed(h.eventBus, 'a', 'r-other'); // 旧连接残留的 runId
    expect(onError).not.toHaveBeenCalled();
    expect(h.manager.hasRun('a')).toBe(true); // 在途 run 不被误收尾

    publishFinished(h.eventBus, 'a', 'r1'); // 真正的终态仍正常收尾
    expect(h.manager.hasRun('a')).toBe(false);
  });

  it('MF-2: RUN_STARTED 已达但 reject 且无终态事件 → finally 仍收尾，refcount 回落', async () => {
    const h = createHarness();
    // core 在 RUN_STARTED publish 之后、主 try 之前抛错的窗口：无终态事件
    h.runAgentTurn.mockRejectedValue(new Error('post-started boom'));

    h.manager.startRun('a', 'p', 'hi');
    publishStarted(h.eventBus, 'a', 'r1');
    expect(isMobileAgentActive()).toBe(true);

    await flushAsync();
    expect(isMobileAgentActive()).toBe(false); // 不再因 runId != null 早退泄漏
    expect(h.manager.hasRun('a')).toBe(false);
  });

  it('MF-6: uiBridge 未注入时匹配的 FAILED 走 console.error 兕底', () => {
    const h = createHarness();
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    h.manager.startRun('a', 'p', 'hi');
    publishStarted(h.eventBus, 'a', 'r1');
    publishFailed(h.eventBus, 'a', 'r1');

    expect(errorSpy).toHaveBeenCalledWith(
      '[novel-master/agent-run-manager] run failed (uiBridge not ready)',
      expect.objectContaining({
        sessionId: 'a',
        runId: 'r1',
        error: 'model error',
      }),
    );
    errorSpy.mockRestore();
  });

  it('MF-6 附带: 无主的 FAILED 不刷兑底日志（只在匹配分支内兑底）', () => {
    const h = createHarness();
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    publishFailed(h.eventBus, 'other', 'r-x');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('dispose: 按记录清零模块级 refcount 并退订（之后的事件不再处理）', () => {
    const h = createHarness();
    const h2 = createHarness();
    h.manager.startRun('a', 'p', '1');
    h.manager.startRun('b', 'p', '2');
    publishStarted(h.eventBus, 'a', 'r1');
    expect(isMobileAgentActive()).toBe(true);

    h.manager.dispose();
    expect(isMobileAgentActive()).toBe(false);
    expect(h.manager.hasRun('a')).toBe(false);

    // 旧总线上的后续终态事件不再触发旧 Manager 的 decrement（防负）
    publishFinished(h.eventBus, 'a', 'r1');
    expect(isMobileAgentActive()).toBe(false);

    // dispose 后拒绝新 run
    const rejected = h.manager.startRun('c', 'p', '3');
    expect(rejected.ok).toBe(false);
    expect(h2.manager.startRun('c', 'p', '3').ok).toBe(true);
    publishStarted(h2.eventBus, 'c', 'r9');
    publishFinished(h2.eventBus, 'c', 'r9');
    expect(isMobileAgentActive()).toBe(false);
  });

  it('MF-5: 构造→dispose→再构造→再 dispose：onForegroundEvent 注册与退订对齐，不随重建累积', () => {
    const h1 = createHarness();
    h1.manager.dispose();
    const h2 = createHarness();
    h2.manager.dispose();

    expect(notifee.onForegroundEvent).toHaveBeenCalledTimes(2);
    expect(onForegroundEventUnsubscribe).toHaveBeenCalledTimes(2);
  });

  describe('通知与保活（T-P4/T-P6 侧）', () => {
    const originalOS = Platform.OS;

    beforeEach(() => {
      (Platform as {OS: string}).OS = 'android';
      // AppState 默认（jest 环境）视为前台，通知不发
      Object.defineProperty(require('react-native').AppState, 'currentState', {
        get: () => 'active',
        configurable: true,
      });
    });

    afterEach(() => {
      (Platform as {OS: string}).OS = originalOS;
    });

    it('T-P6: 完成通知关闭但保活开启时：完成通知不发，前台保活起停照常', async () => {
      const h = createHarness();
      // run 本体挂起（事件由测试驱动）——避免 mock 立即 resolve 触发 finally 早退
      h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
      h.manager.setPrefBridge({
        isEnabled: async () => false,
        isKeepAliveEnabled: async () => true,
      });

      h.manager.startRun('a', 'p', 'hi');
      // 保活服务已随受理启动（asForegroundService 通知）
      await flushAsync();
      expect(notifee.displayNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          android: expect.objectContaining({asForegroundService: true}),
        }),
      );
      expect(notifee.requestPermission).not.toHaveBeenCalled();

      publishStarted(h.eventBus, 'a', 'r1');
      notifee.displayNotification.mockClear();
      publishFinished(h.eventBus, 'a', 'r1');
      await flushAsync();

      // 完成通知未发（偏好关闭），但保活服务正常停止
      expect(notifee.displayNotification).not.toHaveBeenCalled();
      expect(notifee.stopForegroundService).toHaveBeenCalled();
    });

    it('T-P8: 保活默认关（历史兼容）：不注入 isKeepAliveEnabled 时受理不起常驻通知', async () => {
      const h = createHarness();
      h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
      // 旧桥形状（无 isKeepAliveEnabled）——默认视为关
      h.manager.setPrefBridge({isEnabled: async () => true} as never);

      h.manager.startRun('a', 'p', 'hi');
      await flushAsync();
      expect(notifee.displayNotification).not.toHaveBeenCalled();

      publishStarted(h.eventBus, 'a', 'r1');
      publishFinished(h.eventBus, 'a', 'r1');
      await flushAsync();
      // 收尾也不触发任何保活起停
      expect(notifee.stopForegroundService).not.toHaveBeenCalled();
    });

    it('T-P8b: 保活开启时受理即起常驻通知，状态栏带项目 · 会话名', async () => {
      const h = createHarness();
      h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
      h.manager.setPrefBridge({
        isEnabled: async () => true,
        isKeepAliveEnabled: async () => true,
      });

      h.manager.startRun('a', 'p', 'hi');
      await flushAsync();
      expect(notifee.displayNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '正在生成 · 会话-a',
          body: expect.stringContaining('项目-p · 会话-a'),
        }),
      );
    });

    it('偏好开启 + app 在后台时 FINISHED 发完成通知（含会话名）', async () => {
      const h = createHarness();
      h.manager.setPrefBridge({isEnabled: async () => true});
      Object.defineProperty(require('react-native').AppState, 'currentState', {
        get: () => 'background',
        configurable: true,
      });

      h.manager.startRun('a', 'p', 'hi');
      publishStarted(h.eventBus, 'a', 'r1');
      publishFinished(h.eventBus, 'a', 'r1');
      await flushAsync();

      expect(notifee.displayNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '生成完成',
          data: {sessionId: 'a'},
        }),
      );
    });

    it('偏好开启 + 首次发起 run 时申请通知权限', async () => {
      const h = createHarness();
      h.manager.setPrefBridge({isEnabled: async () => true});

      h.manager.startRun('a', 'p', 'hi');
      await flushAsync();
      expect(notifee.requestPermission).toHaveBeenCalledTimes(1);
    });
  });
});
