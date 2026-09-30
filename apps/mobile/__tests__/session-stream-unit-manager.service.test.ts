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
import {
  resetKeepAliveStateForTests,
  setKeepAliveResidentEnabled,
} from '@/services/agent-finished-notification';

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

    // svc/C-1：run 收尾已把 settled 投影写入 manager 级常驻 map，水合
    // 完成前读取口同样恒 null（读侧不提前 expose，与 snapshot 语义对齐）
    publishFinished(h.eventBus, 'a', 'r1');
    expect(h.manager.getSettledProjection('a')).toBe(null);

    h.manager.markHydrated();
    expect(h.manager.isHydrated()).toBe(true);
    // 受理 + RUN_STARTED + 收尾 + markHydrated 各通知一次（水合前通知照发、投影读 null）
    expect(notified).toEqual(['notify', 'notify', 'notify', 'notify']);
    expect(h.manager.snapshot('a')).toEqual(
      expect.objectContaining({status: 'finished', runId: 'r1'}),
    );
    // 水合完成后 settled 投影可读
    expect(h.manager.getSettledProjection('a')).toEqual(
      expect.objectContaining({sessionId: 'a'}),
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

  it('前奏期停止（core 合成 cancelled）：starting 行收成 settled、单元收 finished；registry 依在途时序翻真/假', async () => {
    // 2026-09-30「停止失灵」修复的 mobile 侧收口：core runAgentTurn 在前奏
    // 检查点命中 abort 时以合成 cancelled 结果 resolve——manager 必须补
    // finishRun('', 'finished')，否则受理时写的 starting 行无人收尾，重启水合
    // 会把「用户已停止的发送」误判为中断现场。
    // r3-run-1 起 core 在返回前还会补发一条 FINISHED(runId:'')；本用例钉的是
    // 「事件也没来」的更窄形态（.then 兜底必须真能收口）。
    //
    // r3-test-1 ②：abortRegistry.has 不再是恒 false 的假模型——按 startRun
    // 调起的 run 生命周期翻真/假（core 的 register 落在 runAgentTurn 函数入口，
    // 受理即在途；run 结束即反注册）。恒值模型下「在途/已收尾」两种 registry
    // 读数观测不出差别，下面的 stopRun 前后两断与受理即真全都退化成恒假断言。
    const eventBus = new SimpleEventBus();
    const registryState = {inFlight: false};
    let releasePrelude!: () => void;
    const preludeGate = {
      promise: new Promise<void>(res => {
        releasePrelude = res;
      }),
    };
    const abortRegistry = {
      has: jest.fn((_sessionId: string) => registryState.inFlight),
      abort: jest.fn(),
      register: jest.fn(),
      unregister: jest.fn(),
    };
    const runAgentTurn = jest.fn(async () => {
      // 受理即在途：core 的 register 落在 runAgentTurn 入口（同步）。
      registryState.inFlight = true;
      try {
        // 前奏检查点：run 停在 abort 判定上，由用例放行后以合成 cancelled 返回。
        await preludeGate.promise;
        return {
          stepsExecuted: 0,
          finished: false,
          stopReason: 'cancelled',
          rounds: [],
        };
      } finally {
        // run 结束即反注册。
        registryState.inFlight = false;
      }
    });
    const store = {
      upsert: jest.fn(async () => undefined),
      settle: jest.fn(async () => undefined),
      listByStatuses: jest.fn(async () => []),
    };
    const manager = new SessionStreamUnitManager({
      runtime: {
        eventBus,
        abortRegistry,
        sessions: {
          get: jest.fn(async (id: string) => ({id, title: `会话-${id}`})),
        },
        projects: {
          get: jest.fn(async (id: string) => ({id, name: `项目-${id}`})),
        },
      } as never,
      runAgentTurn: runAgentTurn as never,
      runStateService: store,
      yieldQuantum: async () => undefined,
    });
    liveManagers.push(manager);
    manager.markHydrated();

    expect(manager.startRun('a', 'p', '前奏期停止').ok).toBe(true);
    // 受理即写 starting 行（既有语义）
    expect(store.upsert).toHaveBeenCalledWith(
      expect.objectContaining({sessionId: 'a', status: 'starting'}),
    );
    // 受理空窗内 registry 已是真（core register 在 runAgentTurn 入口执行）：
    // 这条正是 r3-doc-1 纠偏的那条时序，恒值模型下观测不到。
    expect(abortRegistry.has('a')).toBe(true);
    // 空窗期 stopRun 转发得到（读口真按 registry 判活，非恒假）
    expect(manager.stopRun('a')).toBe(true);
    expect(abortRegistry.abort).toHaveBeenCalledWith('a');

    // 前奏检查点命中 abort：core 以合成 cancelled 返回
    releasePrelude();
    await flushAsync();
    await flushAsync();

    // 无任何事件发布，但 .then 补调 finishRun：settled 行落库覆盖 starting 行
    expect(store.settle).toHaveBeenCalledTimes(1);
    expect(store.settle).toHaveBeenCalledWith(
      expect.objectContaining({sessionId: 'a'}),
    );
    // 单元收尾为 finished（宽限内保留终态投影），发送门禁放行
    expect(manager.snapshot('a')).toEqual(
      expect.objectContaining({status: 'finished'}),
    );
    expect(manager.hasActiveRun('a')).toBe(false);
    // 数据源侧同步收口：会话列表「 · 活跃中」meta 读的是 activeSessionIds()，
    // 这条沿必须在无终态事件的受理空窗收尾里也出集（否则该 meta 永久残留）。
    expect(manager.activeSessionIds()).toEqual([]);
    // run 结束后 registry 反注册：读数翻假、stopRun 不再转发、门禁放行下一轮
    expect(abortRegistry.has('a')).toBe(false);
    expect(manager.stopRun('a')).toBe(false);
    expect(manager.startRun('a', 'p', '再来一轮').ok).toBe(true);
    await flushAsync();
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

  it('r3-run-1: 前奏 FAILED(空串) 事件收口后 throw 路径不双弹 toast', async () => {
    // core 前奏抛错时发的是 FAILED(runId:'')——走的是**同一条** finishRun
    // 收口、同样已 onError 过一次。.catch 的 toast 条件必须补
    // `!isSessionStreamUnitSettled(...)`，否则这里会弹第二次。
    const h = createHarness();
    h.runAgentTurn.mockRejectedValue(new Error('前奏炸了'));
    const onError = jest.fn();
    h.manager.setUiBridge({onError});

    h.manager.startRun('a', 'p', 'hi');
    // RUN_STARTED 从未发出；事件入口已有 runId === '' 放行分支。
    h.eventBus.publish(EVENT_AGENT_RUN_FAILED, {
      sessionId: 'a',
      projectId: 'p',
      runId: '',
      error: '前奏炸了',
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(isMobileAgentActive()).toBe(false);

    await flushAsync(); // throw 路径随后到达
    // 前奏 FAILED(空串) 已弹过一次，throw 路径不得再弹
    // （双弹正是 r3-run-1 步骤 5 补 !isSessionStreamUnitSettled 要防的）。
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('r3-run-1: 前奏 FINISHED(空串) 事件收口后 .then 兜底是 no-op', async () => {
    const h = createHarness();
    h.runAgentTurn.mockResolvedValue({
      stepsExecuted: 0,
      finished: false,
      stopReason: 'cancelled',
      rounds: [],
    });
    h.manager.startRun('a', 'p', 'hi');
    h.eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
      sessionId: 'a',
      projectId: 'p',
      runId: '',
      stopReason: 'cancelled',
      vfsMutated: false,
    });
    expect(h.manager.snapshot('a')?.status).toBe('finished');
    expect(isMobileAgentActive()).toBe(false);

    await flushAsync();
    // 事件路径已收口，.then 的兜底 finishRun 必须是 no-op：宽限单元不被销毁、
    // 终态投影不被二次改写、refcount 不被减成负。
    expect(h.manager.snapshot('a')?.status).toBe('finished');
    expect(isMobileAgentActive()).toBe(false);
  });

  it('r3-run-1 步骤 6: 事件+.then 双失时 .finally 仍 invokeOnSettled(failed)', async () => {
    // 最窄的一例：前奏 FAILED('') 事件到达时所有权校验把它当 stale 丢掉
    //（收尾所有权比对按设计如此——迟到的旧 run 事件不能动在途单元）。
    // 这时 onSettled 回调再不发，草稿区不清理、token chip 不刷新，
    // 用户在界面上看不到任何收尾痕迹。
    const h = createHarness();
    h.runAgentTurn.mockRejectedValue(new Error('前奏炸了'));
    const onSettled = jest.fn();
    h.manager.startRun('a', 'p', 'hi', {onSettled});

    // 只发一个不匹配的 runId：事件路径不会 settle 任何东西。
    h.eventBus.publish(EVENT_AGENT_RUN_FAILED, {
      sessionId: 'a',
      projectId: 'p',
      runId: 'run-from-previous',
      error: 'stale',
    });
    expect(onSettled).not.toHaveBeenCalled();
    expect(h.manager.snapshot('a')?.status).toBe('starting');

    await flushAsync();
    // .finally 必须补一个终态出口，否则草稿 / token chip 永久悬着。
    expect(onSettled).toHaveBeenCalledWith('failed');
    expect(isMobileAgentActive()).toBe(false);
    expect(h.manager.hasActiveRun('a')).toBe(false);
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
        metrics: {
          textChars: 0,
          thinkingChars: 0,
          completionTokens: 0,
          tokenSource: 'heuristic',
        },
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
    const h = createHarness({skipHydrate: true});
    let notified = 0;
    h.manager.subscribe(() => {
      notified += 1;
    });

    // svc/C-1：markHydrated 前读取口守卫——水合分片已 adopt 的 interrupted
    // 单元虽在注册表中，读取口仍返回空集（与 snapshot 恒 null 语义对齐，
    // 徽标不分批跳变）
    h.manager.adoptInterruptedUnit('a', 'p');
    expect(h.manager.isHydrated()).toBe(false);
    expect(h.manager.interruptedSessionIds().size).toBe(0);

    // 水合完成：interrupted 单元入集并通知（notifyChanged 驱动 UI 刷新）
    h.manager.markHydrated();
    expect(new Set(h.manager.interruptedSessionIds())).toEqual(new Set(['a']));
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

  it('GWT-7: activeSessionIds 数据源——受理入集、RUN_FINISHED 即时出集并经 subscribe 通知（会话列表「 · 活跃中」meta 的唯一判活源）', () => {
    // 2026-09-30 真机实录的前提锁：徽标一旦改由本数据源驱动，就要求
    // 「收尾即出集」与「迁移即通知」两条都成立，否则徽标会变陈旧。
    const h = createHarness();
    h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
    let notified = 0;
    h.manager.subscribe(() => {
      notified += 1;
    });

    // 受理即 starting → 入集
    expect(h.manager.startRun('a', 'p', 'hi').ok).toBe(true);
    expect(new Set(h.manager.activeSessionIds())).toEqual(new Set(['a']));
    const afterStart = notified;

    // RUN_STARTED → running，仍在集内（run 期间徽标照常显示）
    publishStarted(h.eventBus, 'a', 'r1');
    expect(h.manager.snapshot('a')).toEqual(
      expect.objectContaining({status: 'running', runId: 'r1'}),
    );
    expect(new Set(h.manager.activeSessionIds())).toEqual(new Set(['a']));
    expect(notified).toBeGreaterThan(afterStart);

    // FINISHED → 单元 settle 出集（settled 单元宽限内仍在注册表，但非 active）
    const afterRunning = notified;
    publishFinished(h.eventBus, 'a', 'r1');
    expect(h.manager.snapshot('a')).toEqual(
      expect.objectContaining({status: 'finished'}),
    );
    expect(h.manager.unitCount()).toBe(1);
    expect(h.manager.hasActiveRun('a')).toBe(false);
    expect(h.manager.activeSessionIds()).toEqual([]);
    // 同步总线：事件分发返回前集合已更新且已通知，UI 侧同名回调不读旧值
    expect(notified).toBeGreaterThan(afterRunning);

    // 另一会话在跑时本会话收尾：集合只剩对方（per-session 判定，非全局）
    expect(h.manager.startRun('b', 'p', 'hi').ok).toBe(true);
    publishStarted(h.eventBus, 'b', 'r2');
    expect(new Set(h.manager.activeSessionIds())).toEqual(new Set(['b']));
    publishFinished(h.eventBus, 'b', 'r2');
    expect(h.manager.activeSessionIds()).toEqual([]);
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

    it('T-K5: 常驻开——受理第一段 no-op（零新增刷新），标签查回同 id 切「正在生成」；FINISHED 不停服、回空闲文案', async () => {
      const h = createHarness();
      h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
      h.manager.setPrefBridge({
        isNotificationEnabled: async () => true,
      });

      // 常驻前置（模拟开关开/启动拉起）：空闲文案先上屏 1 次
      await setKeepAliveResidentEnabled(true);
      expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
      const idle = notifee.displayNotification.mock.calls[0][0];
      expect(idle.title).toBe('novel master · 空闲');
      expect(idle.body).toBeUndefined();
      expect(idle.android).toEqual(
        expect.objectContaining({asForegroundService: true}),
      );

      const idleNotificationId = idle.id;
      notifee.displayNotification.mockClear();

      h.manager.startRun('a', 'p', 'hi');
      await flushAsync();
      // 两段式调用序列保留（计数重排）：受理第一段（无标签 start）常驻下
      // no-op——受理零新增刷新；标签查回后带标签刷新恰好 1 次，同 id 原位
      // 切「正在生成 · 会话-a」
      expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
      const labeled = notifee.displayNotification.mock.calls[0][0];
      expect(labeled.id).toBe(idleNotificationId);
      expect(labeled.title).toBe('正在生成 · 会话-a');
      expect(labeled.body).toContain('项目-p · 会话-a');

      notifee.displayNotification.mockClear();
      publishStarted(h.eventBus, 'a', 'r1');
      publishFinished(h.eventBus, 'a', 'r1');
      await flushAsync();

      // 完成通知未发（前台口径独立于开关）；常驻语义反转（原断言停服）：
      // 摘标签后服务不停，通知内容刷回空闲文案
      expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
      expect(
        notifee.displayNotification.mock.calls[0][0].title,
      ).toBe('novel master · 空闲');
      expect(notifee.stopForegroundService).not.toHaveBeenCalled();
    });

    it('T-N1(改锚): 两段式——受理链路不被标签查询阻塞；标签查回后立即同 id 刷新', async () => {
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

      // 常驻前置：空闲文案 1 次后清零，聚焦受理窗口内的增量
      await setKeepAliveResidentEnabled(true);
      notifee.displayNotification.mockClear();

      h.manager.startRun('a', 'p', 'hi');
      await flushAsync();

      // 受理链路不被标签查询阻塞：run 已受理（agent 计数活跃、单元
      // starting、runAgentTurn 已调）、两个标签查询已发出但均未完成；
      // 受理第一段（无标签 start）常驻下 no-op——窗口内零新增刷新
      // （原「通知出现先于标签查询完成」锚随常驻化失效，改锚为不阻塞
      // + 查回后立即刷新）
      expect(isMobileAgentActive()).toBe(true);
      expect(h.manager.snapshot('a')).toEqual(
        expect.objectContaining({status: 'starting', runId: null}),
      );
      expect(h.runAgentTurn).toHaveBeenCalledTimes(1);
      expect(h.sessions.get).toHaveBeenCalledWith('a');
      expect(h.projects.get).toHaveBeenCalledWith('p');
      expect(notifee.displayNotification).not.toHaveBeenCalled();

      // 查回标签：第二段带标签调用经 labelsVersion 同 id 原位刷新
      resolveTitle({id: 'a', title: '会话-a'});
      resolveProject({id: 'p', name: '项目-p'});
      await flushAsync();

      expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
      const refreshed = notifee.displayNotification.mock.calls[0][0];
      expect(refreshed.id).toBe('nm-agent-keepalive');
      expect(refreshed.title).toBe('正在生成 · 会话-a');
      expect(refreshed.body).toContain('项目-p · 会话-a');
    });

    it('消息通知关：受理两段均 no-op 零 display；FINISHED 收尾同样零 display 零 stop', async () => {
      const h = createHarness();
      h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
      h.manager.setPrefBridge({
        isNotificationEnabled: async () => false,
      });

      h.manager.startRun('a', 'p', 'hi');
      await flushAsync();
      // 开关关：受理（第一段登记 + 第二段带标签）全程零通知刷新
      // （PRD 需求 2：开关关闭时受理不产生任何通知刷新）
      expect(notifee.displayNotification).not.toHaveBeenCalled();

      publishStarted(h.eventBus, 'a', 'r1');
      publishFinished(h.eventBus, 'a', 'r1');
      await flushAsync();
      // 收尾摘标签同样零刷新、零停服调用（常驻关时收尾入队走「从未
      // 运行」分支，不触碰 notifee）
      expect(notifee.displayNotification).not.toHaveBeenCalled();
      expect(notifee.stopForegroundService).not.toHaveBeenCalled();
    });

    it('T-K6: dispose 无参全停保持（常驻开也停服）；afterEach reset→dispose 顺序不破坏', async () => {
      // 场景一：常驻开 + 生成中（标签已登记），dispose 直接全停——
      // 无论 resident，无参 stop 清空标签并无条件停服（retry 闪断与
      // 测试防泄漏依赖该语义）
      const h1 = createHarness();
      h1.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
      h1.manager.setPrefBridge({
        isNotificationEnabled: async () => true,
      });
      await setKeepAliveResidentEnabled(true);
      h1.manager.startRun('a', 'p', 'hi');
      await flushAsync();
      // 常驻前置空闲 1 次 + 带标签刷新 1 次，最后一条为「正在生成」
      expect(notifee.displayNotification).toHaveBeenCalledTimes(2);
      expect(
        notifee.displayNotification.mock.calls[1][0].title,
      ).toBe('正在生成 · 会话-a');

      notifee.stopForegroundService.mockClear();
      h1.manager.dispose();
      await flushAsync();
      expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);

      // 场景二：afterEach 的收口顺序（resetKeepAliveStateForTests 先、
      // dispose 后）不破坏——reset 已把模块级 running/desired/resident
      // 复位，dispose 尾部的无参全停在链上按「从未运行」收敛：不抛错、
      // 不再触发 stop；manager 侧（校准轮询等）仍由 dispose 本身收口
      const h2 = createHarness();
      h2.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
      h2.manager.setPrefBridge({
        isNotificationEnabled: async () => true,
      });
      await setKeepAliveResidentEnabled(true);
      h2.manager.startRun('b', 'p', 'hi');
      await flushAsync();

      notifee.stopForegroundService.mockClear();
      notifee.displayNotification.mockClear();
      resetKeepAliveStateForTests();
      expect(() => h2.manager.dispose()).not.toThrow();
      await flushAsync();
      expect(notifee.stopForegroundService).not.toHaveBeenCalled();
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
        metrics: {
          textChars: 0,
          thinkingChars: 0,
          completionTokens: 0,
          tokenSource: 'heuristic',
        },
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

  it('r3-test-1 ⑤: starting 段可直接 settle（前奏受理空窗收尾），状态机放行、宽限定时器照启', () => {
    // 2026-09-30 wave-0 改动：settle 的状态守卫放行 starting 段。前奏期停止
    // 时 RUN_STARTED 从未到达（runId 未回填），受理时建的 starting 单元必须
    // 能被收口，否则 starting 行/单元无人收尾。既有覆盖全在 manager 集成层
    // （r3-run-1 的前奏 FINISHED 用例），单元状态机本身这条迁移没有牙齿。
    jest.useFakeTimers();
    try {
      const expired = jest.fn();
      const unit = new SessionStreamUnit({
        sessionId: 's',
        projectId: 'p',
        settledGraceMs: 1000,
        onGraceExpired: expired,
      });
      expect(unit.begin()).toBe(true);
      expect(unit.getStatus()).toBe('starting');
      expect(unit.getRunId()).toBe(null);

      // 未经 markRunning 直接收尾：迁移被放行
      expect(unit.settle('finished')).toBe(true);
      expect(unit.getStatus()).toBe('finished');
      expect(unit.getRunId()).toBe(null); // runId 始终未回填
      expect(unit.getSettledAtMs()).not.toBeNull();
      expect(unit.snapshot()).toEqual(
        expect.objectContaining({status: 'finished', runId: null}),
      );

      // 收尾后状态机照旧封闭：迟到的 STARTED 不再迁移、重复 settle 被拒
      expect(unit.markRunning('r-late')).toBe(false);
      expect(unit.settle('failed')).toBe(false);
      expect(unit.getStatus()).toBe('finished');
      expect(unit.getRunId()).toBe(null);

      // 宽限定时器照启：starting 收尾同样进宽限期（投影保留语义不打折）
      jest.advanceTimersByTime(1000);
      expect(expired).toHaveBeenCalledWith(unit);
    } finally {
      jest.useRealTimers();
    }
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
