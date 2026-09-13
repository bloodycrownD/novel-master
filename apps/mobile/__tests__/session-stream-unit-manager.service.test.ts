/**
 * SessionStreamUnitManager + SessionStreamUnit 单元测试（mock runtime 范式，
 * 照 agent-run-manager.service.test.ts 的 harness 形状）。
 *
 * 覆盖：
 * - T-P1/P2/P3/P9 全套平移（跨会话并行互不串扰、单会话串行两信号拒绝、
 *   切走会话后 FINISHED 仍 decrement、RUN_STARTED 未达即抛错的 finally 兜底）
 *   ——断言从 entry 投影（getEntry）演化为单元投影（snapshot，settled 宽限
 *   保留是新架构语义）；
 * - T-U1：单元生命周期（idle→starting→running→settled 三种终态）、
 *   宽限期销毁、LRU 上限 8 淘汰最旧；
 * - T-U12 雏形：settled(interrupted) 单元上 startRun → 替换吸收、无双单元
 *   并存、门禁不阻塞；
 * - 水合语义（markHydrated 前投影 null）、runId 所有权校验、dispose 契约、
 *   保活/通知与点按注册的吸收 smoke。
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
import {SessionStreamUnit} from '@/services/session-stream-unit';
import {SESSION_STREAM_SETTLED_GRACE_PERIOD_MS} from '@/services/session-stream-unit';
import {
  SessionStreamUnitManager,
  SESSION_STREAM_MAX_SETTLED_UNITS,
} from '@/services/session-stream-unit-manager.service';
import {Platform} from 'react-native';
import notifee, {onForegroundEventUnsubscribe} from '@notifee/react-native';
import {resetKeepAliveStateForTests} from '@/services/agent-finished-notification';

/** 等待 fire-and-forget promise 链（catch+finally）收敛。 */
async function flushAsync(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

/** 本用例内创建的 manager 登记——afterEach 统一 dispose（防校准轮询 interval 残留）。 */
const liveManagers: SessionStreamUnitManager[] = [];

function createHarness(options?: {readonly skipHydrate?: boolean}) {
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
  const manager = new SessionStreamUnitManager({
    runtime: {eventBus, abortRegistry, sessions, projects} as never,
    runAgentTurn: runAgentTurn as never,
    // Step 2 水合分片的让步点注入同步 mock（fake timers 下无需真实定时器）
    yieldQuantum: async () => undefined,
  });
  liveManagers.push(manager);
  if (options?.skipHydrate !== true) {
    manager.markHydrated();
  }
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

describe('SessionStreamUnitManager', () => {
  beforeEach(() => {
    setMobileAgentActive(false);
    jest.clearAllMocks();
    resetKeepAliveStateForTests();
  });

  afterEach(() => {
    setMobileAgentActive(false);
    resetKeepAliveStateForTests();
    // 未在用例内 dispose 的 manager 统一收口：清校准轮询 interval 与
    // 复询定时器，防 jest 环境拆除后异步路径再触碰 RN 模块。
    for (const manager of liveManagers.splice(0)) {
      manager.dispose();
    }
  });

  it('水合语义：markHydrated 前投影一律 null（会话呈现为无 run）；置位后可读并通知', () => {
    const h = createHarness({skipHydrate: true});
    const notified: string[] = [];
    h.manager.subscribe(() => notified.push('notify'));

    // 受理发生在水合完成前（写侧不被水合挡住），投影仍读不到
    expect(h.manager.isHydrated()).toBe(false);
    expect(h.manager.startRun('a', 'p', 'hi').ok).toBe(true);
    publishStarted(h.eventBus, 'a', 'r1');
    expect(h.manager.snapshot('a')).toBe(null);

    h.manager.markHydrated();
    expect(h.manager.isHydrated()).toBe(true);
    // 受理 + RUN_STARTED + markHydrated 各通知一次（水合前通知照发、投影读 null）
    expect(notified).toEqual(['notify', 'notify', 'notify']);
    expect(h.manager.snapshot('a')).toEqual(
      expect.objectContaining({status: 'running', runId: 'r1'}),
    );
  });

  it('T-P3d: 投影随生命周期迁移（starting→running→settled 宽限保留），subscribe 逐点通知', () => {
    const h = createHarness();
    h.runAgentTurn.mockImplementation(
      () => new Promise<undefined>(() => undefined),
    );
    const events: string[] = [];
    const unsubscribe = h.manager.subscribe(() => events.push('notify'));

    // 受理 → starting（runId 未知）
    expect(h.manager.startRun('s1', 'p', 'hi').ok).toBe(true);
    expect(h.manager.snapshot('s1')).toEqual(
      expect.objectContaining({status: 'starting', runId: null}),
    );
    expect(h.manager.hasActiveRun('s1')).toBe(true);
    expect(events).toHaveLength(1);

    // RUN_STARTED → running + runId 回填
    publishStarted(h.eventBus, 's1', 'r1');
    expect(h.manager.snapshot('s1')).toEqual(
      expect.objectContaining({status: 'running', runId: 'r1'}),
    );
    expect(events).toHaveLength(2);

    // FINISHED → settled（宽限内保留终态投影，hasActiveRun 归 false）
    publishFinished(h.eventBus, 's1', 'r1');
    expect(h.manager.snapshot('s1')).toEqual(
      expect.objectContaining({status: 'finished', runId: 'r1'}),
    );
    expect(h.manager.hasActiveRun('s1')).toBe(false);
    expect(events).toHaveLength(3);

    // 退订后不再通知
    unsubscribe();
    expect(h.manager.startRun('s2', 'p', 'again').ok).toBe(true);
    expect(events).toHaveLength(3);
    expect(h.manager.snapshot('s2')).toEqual(
      expect.objectContaining({status: 'starting'}),
    );
  });

  it('T-P1: session A run 进行中 startRun(B) 正常受理，事件与状态互不串扰', () => {
    const h = createHarness();
    h.runAgentTurn.mockImplementation(
      () => new Promise<undefined>(() => undefined),
    );
    const settledA = jest.fn();
    const settledB = jest.fn();

    expect(h.manager.startRun('a', 'p', 'hi', {onSettled: settledA})).toEqual({
      ok: true,
    });
    publishStarted(h.eventBus, 'a', 'r1');
    expect(h.manager.hasActiveRun('a')).toBe(true);

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
    expect(h.manager.hasActiveRun('a')).toBe(false);
    expect(h.manager.hasActiveRun('b')).toBe(true);
    expect(h.manager.snapshot('a')?.status).toBe('finished');
    expect(h.manager.snapshot('b')?.status).toBe('running');
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

  it('T-P2: 单元处 starting（RUN_STARTED 未达、registry 未注册）时二次 startRun 同样被拒', () => {
    const h = createHarness();
    h.runAgentTurn.mockImplementation(
      () => new Promise<undefined>(() => undefined),
    );
    // registry 尚未 register（受理→register 的异步空窗）
    h.abortRegistry.has.mockReturnValue(false);

    expect(h.manager.startRun('a', 'p', 'first').ok).toBe(true);
    // 空窗内第二个同会话 run 必须被 starting 态单元拦住
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
    h.runAgentTurn.mockImplementation(
      () => new Promise<undefined>(() => undefined),
    );
    expect(h.manager.startRun('a', 'p', 'hi').ok).toBe(true);
    publishStarted(h.eventBus, 'a', 'r1');
    expect(isMobileAgentActive()).toBe(true);

    // 无任何 UI 面板订阅过滤——manager 全量事件直接收尾
    publishFinished(h.eventBus, 'a', 'r1');
    expect(isMobileAgentActive()).toBe(false);
    expect(h.manager.hasActiveRun('a')).toBe(false);
    // 终态投影在宽限期内保留（新架构语义：服务「上次生成」过渡展示）
    expect(h.manager.snapshot('a')?.status).toBe('finished');
  });

  it('RUN_STARTED 只迁移单元状态不碰 refcount；FAILED 走 decrement + onSettled(failed)', () => {
    const h = createHarness();
    h.runAgentTurn.mockImplementation(
      () => new Promise<undefined>(() => undefined),
    );
    const settled = jest.fn();
    h.manager.startRun('a', 'p', 'hi', {onSettled: settled});

    publishStarted(h.eventBus, 'a', 'r1');
    expect(isMobileAgentActive()).toBe(true); // increment 只在受理路径

    publishFailed(h.eventBus, 'a', 'r1');
    expect(settled).toHaveBeenCalledWith('failed');
    expect(h.manager.snapshot('a')?.status).toBe('failed');
    expect(isMobileAgentActive()).toBe(false);
  });

  it('T-P9: startRun 后未收到 RUN_STARTED 即抛错 → finally 清单元并 decrement，refcount 回落', async () => {
    const h = createHarness();
    h.runAgentTurn.mockRejectedValue(new Error('early boom'));

    expect(h.manager.startRun('a', 'p', 'hi').ok).toBe(true);
    expect(isMobileAgentActive()).toBe(true); // 受理路径已同步 increment

    await flushAsync();
    expect(isMobileAgentActive()).toBe(false); // finally 兜底回落
    expect(h.manager.hasActiveRun('a')).toBe(false);
    expect(h.manager.snapshot('a')).toBe(null); // 非正常终态：直接销毁出表

    // 后续 run 不被卡死（refcount 已回落即可重新受理）
    h.runAgentTurn.mockResolvedValue(undefined);
    expect(h.manager.startRun('a', 'p', 'again').ok).toBe(true);
    await flushAsync();
  });

  it('T-P9 变体: 事件路径已收尾（settled 宽限中）时 finally 不双减、不销毁宽限单元', async () => {
    const h = createHarness();
    h.runAgentTurn.mockRejectedValue(new Error('late boom'));

    h.manager.startRun('a', 'p', 'hi');
    publishStarted(h.eventBus, 'a', 'r1');
    publishFinished(h.eventBus, 'a', 'r1'); // 事件路径已 decrement + settle
    expect(isMobileAgentActive()).toBe(false);
    expect(h.manager.snapshot('a')?.status).toBe('finished');

    await flushAsync();
    expect(isMobileAgentActive()).toBe(false); // finally 未把计数减成负
    expect(h.manager.snapshot('a')?.status).toBe('finished'); // 宽限单元未被 finally 提前销毁
  });

  it('RUN_STARTED 后失败只弹一次 toast（事件路径已收尾，throw 路径不重复弹）', async () => {
    const h = createHarness();
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

  it('MF-1: 无单元的 FAILED 事件不弹 toast（subagent 子 run / 旧连接残留不误报）', () => {
    const h = createHarness();
    const onError = jest.fn();
    h.manager.setUiBridge({onError});

    publishFailed(h.eventBus, 'other', 'r-x'); // 无单元的会话
    expect(onError).not.toHaveBeenCalled();
  });

  it('MF-1: runId 不匹配的 FAILED 不弹 toast，且不影响在途 run（收尾所有权校验）', () => {
    const h = createHarness();
    h.runAgentTurn.mockImplementation(
      () => new Promise<undefined>(() => undefined),
    );
    const onError = jest.fn();
    h.manager.setUiBridge({onError});

    h.manager.startRun('a', 'p', 'hi');
    publishStarted(h.eventBus, 'a', 'r1');
    publishFailed(h.eventBus, 'a', 'r-other'); // 旧连接残留的 runId
    expect(onError).not.toHaveBeenCalled();
    expect(h.manager.snapshot('a')?.status).toBe('running'); // 在途 run 不被误收尾

    publishFinished(h.eventBus, 'a', 'r1'); // 真正的终态仍正常收尾
    expect(h.manager.snapshot('a')?.status).toBe('finished');
    expect(isMobileAgentActive()).toBe(false);
  });

  it('迟到的 RUN_STARTED 不改 settled 投影（markRunning 状态守卫）', () => {
    const h = createHarness();
    h.runAgentTurn.mockImplementation(
      () => new Promise<undefined>(() => undefined),
    );
    h.manager.startRun('a', 'p', 'hi');
    publishStarted(h.eventBus, 'a', 'r1');
    publishFinished(h.eventBus, 'a', 'r1');

    publishStarted(h.eventBus, 'a', 'r-late'); // 理论不该来，防御
    expect(h.manager.snapshot('a')).toEqual(
      expect.objectContaining({status: 'finished', runId: 'r1'}),
    );
  });

  it('T-U12: settled(interrupted) 单元上 startRun → 替换吸收、无双单元并存、门禁不阻塞', () => {
    const h = createHarness();
    h.runAgentTurn.mockImplementation(
      () => new Promise<undefined>(() => undefined),
    );
    const old = h.manager.adoptInterruptedUnit('a', 'p');
    expect(h.manager.snapshot('a')?.status).toBe('interrupted');

    // settled 单元不阻塞新 run（门禁只认 starting|running）
    const settled = jest.fn();
    expect(h.manager.startRun('a', 'p', 'hi', {onSettled: settled}).ok).toBe(
      true,
    );
    // 替换吸收：删旧建新，无双单元并存；新单元状态机回 starting、字段按新 run 重置
    expect(h.manager.unitCount()).toBe(1);
    expect(old.isDestroyed()).toBe(true);
    expect(h.manager.snapshot('a')).toEqual(
      expect.objectContaining({
        status: 'starting',
        runId: null,
        metrics: {textChars: 0, thinkingChars: 0},
        partialText: '',
        partialThinking: '',
        injected: false,
        pendingChildren: [],
      }),
    );

    // 新 run 全生命周期正常流转（旧单元不再挡道）
    publishStarted(h.eventBus, 'a', 'r1');
    expect(h.manager.snapshot('a')).toEqual(
      expect.objectContaining({status: 'running', runId: 'r1'}),
    );
    publishFinished(h.eventBus, 'a', 'r1');
    expect(settled).toHaveBeenCalledWith('finished');
    expect(isMobileAgentActive()).toBe(false);
    expect(h.manager.snapshot('a')?.status).toBe('finished');
  });

  it('T-U1: settled 后宽限到期销毁出注册表', () => {
    jest.useFakeTimers();
    try {
      const h = createHarness({skipHydrate: true});
      h.manager.markHydrated();
      h.runAgentTurn.mockImplementation(
        () => new Promise<undefined>(() => undefined),
      );
      h.manager.startRun('a', 'p', 'hi');
      publishStarted(h.eventBus, 'a', 'r1');
      publishFinished(h.eventBus, 'a', 'r1');
      expect(h.manager.snapshot('a')?.status).toBe('finished');
      expect(h.manager.unitCount()).toBe(1);

      jest.advanceTimersByTime(SESSION_STREAM_SETTLED_GRACE_PERIOD_MS - 1);
      expect(h.manager.snapshot('a')?.status).toBe('finished');

      jest.advanceTimersByTime(1);
      expect(h.manager.snapshot('a')).toBe(null);
      expect(h.manager.unitCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('T-U1: LRU 上限 8——settled 超限淘汰最旧；活跃单元不占槽、不触发淘汰', () => {
    const h = createHarness();
    h.runAgentTurn.mockImplementation(
      () => new Promise<undefined>(() => undefined),
    );
    for (let i = 1; i <= 9; i += 1) {
      h.manager.adoptInterruptedUnit(`s${i}`, 'p');
    }
    expect(h.manager.unitCount()).toBe(SESSION_STREAM_MAX_SETTLED_UNITS);
    expect(h.manager.snapshot('s1')).toBe(null); // 最旧被淘汰
    expect(h.manager.snapshot('s2')?.status).toBe('interrupted');
    expect(h.manager.snapshot('s9')?.status).toBe('interrupted');

    // 活跃单元不计入 LRU 槽位：settled 8 个 + active 1 个并存
    h.manager.startRun('active', 'p', 'hi');
    publishStarted(h.eventBus, 'active', 'ra');
    expect(h.manager.unitCount()).toBe(SESSION_STREAM_MAX_SETTLED_UNITS + 1);
    expect(h.manager.snapshot('s2')?.status).toBe('interrupted'); // 不因 active 入表被淘汰
  });

  it('dispose: 按活跃单元清零 refcount、销毁全部单元、退订（后续事件不再处理）', () => {
    const h = createHarness();
    const h2 = createHarness();
    h.runAgentTurn.mockImplementation(
      () => new Promise<undefined>(() => undefined),
    );
    // 活跃 2 个（starting + running）+ settled 1 个
    h.manager.startRun('a', 'p', '1');
    h.manager.startRun('b', 'p', '2');
    publishStarted(h.eventBus, 'a', 'r1');
    h.manager.startRun('c', 'p', '3');
    publishStarted(h.eventBus, 'c', 'r3');
    publishFinished(h.eventBus, 'c', 'r3');
    expect(isMobileAgentActive()).toBe(true);

    h.manager.dispose();
    expect(isMobileAgentActive()).toBe(false);
    expect(h.manager.unitCount()).toBe(0);
    expect(h.manager.hasActiveRun('a')).toBe(false);

    // 旧总线上的后续终态事件不再触发旧 manager 的 decrement（防负）
    publishFinished(h.eventBus, 'a', 'r1');
    expect(isMobileAgentActive()).toBe(false);

    // dispose 后拒绝新 run
    const rejected = h.manager.startRun('d', 'p', '4');
    expect(rejected.ok).toBe(false);
    expect(h2.manager.startRun('d', 'p', '4').ok).toBe(true);
    publishStarted(h2.eventBus, 'd', 'r9');
    publishFinished(h2.eventBus, 'd', 'r9');
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

  it('stopRun: 转发 abortRegistry.abort（未注册返回 false）', () => {
    const h = createHarness();
    expect(h.manager.stopRun('a')).toBe(false);
    h.abortRegistry.has.mockReturnValue(true);
    expect(h.manager.stopRun('a')).toBe(true);
    expect(h.abortRegistry.abort).toHaveBeenCalledWith('a');
  });

  it('T-X1: interruptedSessionIds 数据源——interrupted 单元入集；替换/删除出集；迁移经 subscribe 通知', () => {
    const h = createHarness();
    let notified = 0;
    h.manager.subscribe(() => {
      notified += 1;
    });

    // 水合回填：interrupted 单元入集并通知（notifyChanged 驱动 UI 刷新）
    h.manager.adoptInterruptedUnit('a', 'p');
    h.manager.adoptInterruptedUnit('b', 'p');
    expect(new Set(h.manager.interruptedSessionIds())).toEqual(
      new Set(['a', 'b']),
    );
    const notifiedAfterAdopt = notified;
    expect(notifiedAfterAdopt).toBeGreaterThan(0);

    // 活跃 run 单元不入集
    h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
    h.manager.startRun('c', 'p', 'hi');
    publishStarted(h.eventBus, 'c', 'r1');
    expect(h.manager.interruptedSessionIds().has('c')).toBe(false);
    expect(new Set(h.manager.interruptedSessionIds())).toEqual(
      new Set(['a', 'b']),
    );

    // interrupted 单元重跑（替换吸收）：出集并通知
    h.manager.startRun('a', 'p', 'again');
    publishStarted(h.eventBus, 'a', 'r2');
    expect(h.manager.interruptedSessionIds().has('a')).toBe(false);
    expect(new Set(h.manager.interruptedSessionIds())).toEqual(new Set(['b']));

    // 会话删除（forgetSession）：出集并通知
    h.manager.forgetSession('b');
    expect(h.manager.interruptedSessionIds().size).toBe(0);
    expect(notified).toBeGreaterThan(notifiedAfterAdopt);
  });

  describe('保活前台服务（吸收契约 smoke）', () => {
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

    it('消息通知开时受理即起常驻通知（默认文案先行、标签查回同 id 刷新）；FINISHED 后停止', async () => {
      const h = createHarness();
      h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
      h.manager.setPrefBridge({
        isNotificationEnabled: async () => true,
      });

      h.manager.startRun('a', 'p', 'hi');
      await flushAsync();
      // 两段式（Step 8）：受理后默认文案立即上屏，标签查回后同 id 原位刷新
      expect(notifee.displayNotification).toHaveBeenCalledTimes(2);
      expect(notifee.displayNotification.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          android: expect.objectContaining({asForegroundService: true}),
        }),
      );
      expect(notifee.displayNotification.mock.calls[0][0].title).toBe(
        '正在生成',
      );
      expect(notifee.displayNotification.mock.calls[1][0].title).toBe(
        '正在生成 · 会话-a',
      );
      expect(notifee.displayNotification.mock.calls[0][0].id).toBe(
        notifee.displayNotification.mock.calls[1][0].id,
      );

      notifee.displayNotification.mockClear();
      publishStarted(h.eventBus, 'a', 'r1');
      publishFinished(h.eventBus, 'a', 'r1');
      await flushAsync();

      // 完成通知未发（前台口径独立于开关），但保活服务正常停止
      expect(notifee.displayNotification).not.toHaveBeenCalled();
      expect(notifee.stopForegroundService).toHaveBeenCalled();
    });

    it('T-N1: 两段式——默认文案首调先于标签查询完成；标签查回后同 id 原位刷新', async () => {
      const h = createHarness();
      h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
      h.manager.setPrefBridge({
        isNotificationEnabled: async () => true,
      });

      // 标签两查询挂起（手动 resolve）：制造「查询长时间未完成」窗口
      let resolveTitle!: (value: {id: string; title: string}) => void;
      let resolveProject!: (value: {id: string; name: string}) => void;
      h.sessions.get.mockImplementation(
        () =>
          new Promise(resolve => {
            resolveTitle = resolve;
          }),
      );
      h.projects.get.mockImplementation(
        () =>
          new Promise(resolve => {
            resolveProject = resolve;
          }),
      );

      h.manager.startRun('a', 'p', 'hi');
      await flushAsync();

      // 第一段已用默认文案上屏；两个标签查询虽已发出但都未完成——
      // 通知出现先于标签查询完成（忙期优先的核心断言）
      expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
      expect(notifee.displayNotification.mock.calls[0][0].title).toBe(
        '正在生成',
      );
      expect(h.sessions.get).toHaveBeenCalledWith('a');
      expect(h.projects.get).toHaveBeenCalledWith('p');

      // 查回标签：第二段带标签调用经 labelsVersion 同 id 原位刷新
      resolveTitle({id: 'a', title: '会话-a'});
      resolveProject({id: 'p', name: '项目-p'});
      await flushAsync();

      expect(notifee.displayNotification).toHaveBeenCalledTimes(2);
      const first = notifee.displayNotification.mock.calls[0][0];
      const refreshed = notifee.displayNotification.mock.calls[1][0];
      expect(first.id).toBe('nm-agent-keepalive');
      expect(refreshed.id).toBe(first.id);
      expect(refreshed.title).toBe('正在生成 · 会话-a');
      expect(refreshed.body).toContain('项目-p · 会话-a');
    });

    it('消息通知关：受理不起常驻通知', async () => {
      const h = createHarness();
      h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
      h.manager.setPrefBridge({
        isNotificationEnabled: async () => false,
      });

      h.manager.startRun('a', 'p', 'hi');
      await flushAsync();
      expect(notifee.displayNotification).not.toHaveBeenCalled();
    });
  });
});

describe('SessionStreamUnit', () => {
  it('T-U1: 生命周期 idle→starting→running→settled 三种终态', () => {
    const finished = new SessionStreamUnit({sessionId: 's', projectId: 'p'});
    expect(finished.getStatus()).toBe('idle');
    expect(finished.getRunId()).toBe(null);
    expect(finished.snapshot()).toEqual(
      expect.objectContaining({
        status: 'idle',
        sessionId: 's',
        projectId: 'p',
        metrics: {textChars: 0, thinkingChars: 0},
      }),
    );

    expect(finished.begin()).toBe(true);
    expect(finished.getStatus()).toBe('starting');
    expect(finished.markRunning('r1')).toBe(true);
    expect(finished.getStatus()).toBe('running');
    expect(finished.getRunId()).toBe('r1');
    expect(finished.settle('finished')).toBe(true);
    expect(finished.getStatus()).toBe('finished');
    expect(finished.getSettledAtMs()).not.toBeNull();
    expect(finished.snapshot()).toEqual(
      expect.objectContaining({status: 'finished', runId: 'r1'}),
    );

    const failed = new SessionStreamUnit({sessionId: 's', projectId: 'p'});
    failed.begin();
    failed.markRunning('r2');
    expect(failed.settle('failed')).toBe(true);
    expect(failed.getStatus()).toBe('failed');

    // interrupted 终态（水合路径：idle 直达）
    const interrupted = new SessionStreamUnit({sessionId: 's', projectId: 'p'});
    expect(interrupted.settleAsInterrupted()).toBe(true);
    expect(interrupted.getStatus()).toBe('interrupted');
    expect(interrupted.getSettledAtMs()).not.toBeNull();
  });

  it('T-U1: 非法迁移被拒绝（状态机守卫；销毁后一切迁移拒绝）', () => {
    const u = new SessionStreamUnit({sessionId: 's', projectId: 'p'});
    expect(u.markRunning('r')).toBe(false); // 非 starting
    expect(u.settle('finished')).toBe(false); // 非 running
    expect(u.settleAsInterrupted()).toBe(true);
    expect(u.settleAsInterrupted()).toBe(false); // 重复
    expect(u.begin()).toBe(false); // 非 idle
    expect(u.markRunning('r')).toBe(false); // settled 后

    const u2 = new SessionStreamUnit({sessionId: 's2', projectId: 'p'});
    expect(u2.begin()).toBe(true);
    expect(u2.begin()).toBe(false); // 重复受理

    const u3 = new SessionStreamUnit({sessionId: 's3', projectId: 'p'});
    u3.destroy();
    expect(u3.begin()).toBe(false); // 销毁后拒绝
    expect(u3.isDestroyed()).toBe(true);
  });

  it('T-U1: 宽限到期触发 onGraceExpired；destroy 清定时器不再触发', () => {
    jest.useFakeTimers();
    try {
      const expired = jest.fn();
      const unit = new SessionStreamUnit({
        sessionId: 's',
        projectId: 'p',
        settledGraceMs: 1000,
        onGraceExpired: expired,
      });
      unit.begin();
      unit.markRunning('r1');
      unit.settle('finished');
      jest.advanceTimersByTime(999);
      expect(expired).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(expired).toHaveBeenCalledWith(unit);

      // destroy 清宽限定时器
      const expired2 = jest.fn();
      const unit2 = new SessionStreamUnit({
        sessionId: 's2',
        projectId: 'p',
        settledGraceMs: 1000,
        onGraceExpired: expired2,
      });
      unit2.begin();
      unit2.markRunning('r2');
      unit2.settle('failed');
      unit2.destroy();
      jest.advanceTimersByTime(60_000);
      expect(expired2).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('interrupted 不启动宽限定时器（常驻至替换/LRU 淘汰）', () => {
    jest.useFakeTimers();
    try {
      const expired = jest.fn();
      const unit = new SessionStreamUnit({
        sessionId: 's',
        projectId: 'p',
        settledGraceMs: 1000,
        onGraceExpired: expired,
      });
      unit.settleAsInterrupted();
      jest.advanceTimersByTime(60_000);
      expect(expired).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('webview 注册表：最后 attach 的可见句柄收流式、控制消息全句柄广播、detach 回退', () => {
    const unit = new SessionStreamUnit({sessionId: 's', projectId: 'p'});
    const seen: string[] = [];
    const w1 = {
      handleId: 'w1',
      onStreamPayload: (payload: unknown) => seen.push(`w1:${String(payload)}`),
      onControlMessage: (message: unknown) =>
        seen.push(`w1:ctl:${String(message)}`),
    };
    const w2 = {
      handleId: 'w2',
      onStreamPayload: (payload: unknown) => seen.push(`w2:${String(payload)}`),
      onControlMessage: (message: unknown) =>
        seen.push(`w2:ctl:${String(message)}`),
    };
    unit.attachWebview(w1);
    unit.attachWebview(w2);
    expect(unit.getWebviewCount()).toBe(2);
    expect(unit.resolveStreamingWebview()?.handleId).toBe('w2'); // 最后 attach

    unit.pushStreamPayload('delta');
    expect(seen).toEqual(['w2:delta']); // 只有流式目标句柄收到

    unit.broadcastControlMessage('commit');
    expect(seen).toEqual(['w2:delta', 'w1:ctl:commit', 'w2:ctl:commit']); // 全句柄广播

    unit.detachWebview('w2');
    expect(unit.resolveStreamingWebview()?.handleId).toBe('w1'); // 回退到前一个
    unit.detachWebview('nonexistent'); // 未注册的 no-op
    expect(unit.getWebviewCount()).toBe(1);

    // 不可见句柄不收流式：最后 attach 但不可见 → 回到 w1
    unit.attachWebview({
      handleId: 'w3',
      isVisible: () => false,
      onStreamPayload: payload => seen.push(`w3:${String(payload)}`),
    });
    expect(unit.resolveStreamingWebview()?.handleId).toBe('w1');
    unit.pushStreamPayload('more');
    expect(seen).toEqual([
      'w2:delta',
      'w1:ctl:commit',
      'w2:ctl:commit',
      'w1:more',
    ]);
  });

  it('重复 attach 同 handleId 先移除旧条目；destroy 清空注册表', () => {
    const unit = new SessionStreamUnit({sessionId: 's', projectId: 'p'});
    const w1 = {handleId: 'w1', onControlMessage: jest.fn()};
    unit.attachWebview(w1);
    unit.attachWebview({...w1, onControlMessage: jest.fn()}); // 同 id 重新 attach
    expect(unit.getWebviewCount()).toBe(1);

    unit.destroy();
    expect(unit.getWebviewCount()).toBe(0);
    expect(unit.resolveStreamingWebview()).toBe(null);
    unit.broadcastControlMessage('x'); // no-op 不抛错
  });
});
