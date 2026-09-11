/**
 * 会话流式单元持久化测试（Step 5 — phase-persist-writethrough）。
 *
 * 覆盖：
 * - T-U7：写通节流合并（250ms 内多次 delta 只一次 upsert）/ step 边界
 *   立即刷 / 大载荷降频 1s；水合建 interrupted 单元（partial/指标/链接
 *   全恢复、无 coalescer）；正常收尾 → settle 落库 + settled 投影更新
 *   +「重启」（新 manager 实例 + 同服务数据）后 settled 投影回填可读
 *   「上次生成」；
 * - T-U12（完整版）：interrupted 单元上 startRun → 门禁不阻塞、替换吸收、
 *   无双单元、指标按新 run 重置、无旧写覆盖新行；
 * - dispose：在途 coalescer 尽力 flush（成功落盘 / 失败吞错均不阻塞）。
 *
 * 写通 coalescer 另附模块级单测（三态语义 / 降频档 / 僵尸写防御）。
 *
 * @module test/session-stream-unit-persist
 */
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import {
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  SimpleEventBus,
} from '@novel-master/core/events';
import type {SessionRunState} from '@novel-master/core/session-run-state';
import {
  isMobileAgentActive,
  setMobileAgentActive,
} from '@/runtime/agent-activity';
import {
  SessionStreamUnitManager,
  SESSION_STREAM_MAX_SETTLED_UNITS,
} from '@/services/session-stream-unit-manager.service';
import type {SessionStreamRunStateStore} from '@/services/session-stream-unit-manager.service';
import {
  createRunStateWritethrough,
  RUN_STATE_WRITETHROUGH_INTERVAL_MS,
  RUN_STATE_WRITETHROUGH_SLOW_INTERVAL_MS,
} from '@/services/run-state-writethrough';
import {
  SESSION_STREAM_APPLY_INTERVAL_MS,
  SESSION_STREAM_INGRESS_COALESCE_MS,
} from '@/services/session-stream-unit';
import {resetKeepAliveStateForTests} from '@/services/agent-finished-notification';

/** 时钟起点（fake timers 的 Date.now 从此起算，断言可精确）。 */
const CLOCK_START_MS = 1_000_000;

/** 测试用宽限销毁时长（短值，方便推进宽限到期断言）。 */
const TEST_SETTLED_GRACE_MS = 5_000;

/** 推过两段缓冲（32ms 合并 + 64ms apply）所需的全部时间。 */
function advanceStreamTimers(extraMs = 10): void {
  jest.advanceTimersByTime(
    SESSION_STREAM_INGRESS_COALESCE_MS +
      SESSION_STREAM_APPLY_INTERVAL_MS +
      extraMs,
  );
}

/** 统一记录的服务调用（跨类型保序，供水合/写通时序断言）。 */
interface StoreCall {
  readonly op: 'upsert' | 'settle' | 'list';
  readonly at: number;
  readonly sessionId?: string;
  readonly statuses?: readonly string[];
}

/**
 * 内存版 run 状态服务（真实 upsert/settle/listByStatuses 语义），
 * 跨 manager 实例共享即模拟「重启后同服务数据」。
 */
function createFakeRunStateStore() {
  const rows = new Map<string, SessionRunState>();
  const calls: StoreCall[] = [];
  let failUpsert = false;
  const store: SessionStreamRunStateStore = {
    async upsert(state) {
      calls.push({op: 'upsert', at: Date.now(), sessionId: state.sessionId});
      if (failUpsert) {
        throw new Error('db closed');
      }
      rows.set(state.sessionId, {...state});
    },
    async settle(input) {
      calls.push({op: 'settle', at: Date.now(), sessionId: input.sessionId});
      if (failUpsert) {
        throw new Error('db closed');
      }
      const previous = rows.get(input.sessionId);
      rows.set(input.sessionId, {
        sessionId: input.sessionId,
        projectId: input.projectId,
        runId: input.runId,
        status: 'settled',
        startedAtMs: input.startedAtMs,
        textChars: input.textChars,
        thinkingChars: input.thinkingChars,
        // settle 服务端语义：partial 三字段清空、metrics 保留。
        partialText: null,
        partialThinking: null,
        pendingChildrenJson: null,
        updatedAtMs: input.updatedAtMs,
        ...(previous == null ? {} : {projectId: previous.projectId}),
      });
    },
    async listByStatuses(statuses) {
      calls.push({
        op: 'list',
        at: Date.now(),
        statuses: [...statuses],
      });
      return [...rows.values()]
        .filter(row => (statuses as readonly string[]).includes(row.status))
        .sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1))
        .map(row => ({...row}));
    },
  };
  return {
    store,
    rows,
    calls,
    upsertCallsFor(sessionId: string): number {
      return calls.filter(
        call => call.op === 'upsert' && call.sessionId === sessionId,
      ).length;
    },
    settleCallsFor(sessionId: string): number {
      return calls.filter(
        call => call.op === 'settle' && call.sessionId === sessionId,
      ).length;
    },
    lastUpsertFor(sessionId: string): SessionRunState | undefined {
      const found = [...rows.values()].find(
        row => row.sessionId === sessionId,
      );
      return found == null ? undefined : {...found};
    },
    /** 预置一行（水合场景造数）。 */
    seed(row: SessionRunState): void {
      rows.set(row.sessionId, {...row});
    },
    /** 让 upsert/settle 拒绝（dispose 吞错场景）。 */
    setFailUpsert(value: boolean): void {
      failUpsert = value;
    },
  };
}

function createHarness(options?: {
  readonly runStateStore?: SessionStreamRunStateStore;
}) {
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
    settledGraceMs: TEST_SETTLED_GRACE_MS,
    runStateService: options?.runStateStore,
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

function publishTextDelta(
  eventBus: SimpleEventBus,
  sessionId: string,
  runId: string,
  text: string,
): void {
  eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
    sessionId,
    runId,
    text,
  });
}

function publishStepCommitted(
  eventBus: SimpleEventBus,
  sessionId: string,
  runId: string,
): void {
  eventBus.publish(EVENT_AGENT_STEP_COMMITTED, {
    sessionId,
    projectId: 'p',
    runId,
    phase: 'assistant',
  });
}

/** 受理 + RUN_STARTED 回填（runAgentTurn 挂起，防 finally 兜底干扰）。 */
function startRunningRun(
  h: ReturnType<typeof createHarness>,
  sessionId: string,
  runId: string,
): void {
  h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
  expect(h.manager.startRun(sessionId, 'p', 'hi').ok).toBe(true);
  publishStarted(h.eventBus, sessionId, runId);
}

/** 构造一行 run_state（部分字段可覆盖）。 */
function makeRow(
  sessionId: string,
  projectId: string,
  overrides: Partial<SessionRunState> = {},
): SessionRunState {
  return {
    sessionId,
    projectId,
    runId: `run-${sessionId}`,
    status: 'running',
    startedAtMs: 2_000,
    textChars: 0,
    thinkingChars: 0,
    partialText: null,
    partialThinking: null,
    pendingChildrenJson: null,
    updatedAtMs: 3_000,
    ...overrides,
  };
}

describe('run-state-writethrough（coalescer 三态）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(CLOCK_START_MS);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('节流合并：窗口内多次 append 只一次写，落盘为最新快照；窗口滚动后再写', () => {
    const write = jest.fn(async () => undefined);
    const wt = createRunStateWritethrough(write);

    wt.append(makeRow('s', 'p', {textChars: 1, partialText: 'a'}));
    wt.append(makeRow('s', 'p', {textChars: 2, partialText: 'ab'}));
    wt.append(makeRow('s', 'p', {textChars: 3, partialText: 'abc'}));
    // 窗口内不写
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_INTERVAL_MS - 1);
    expect(write).not.toHaveBeenCalled();
    expect(wt.hasPending()).toBe(true);

    // 窗口到期 → 一次写，内容是最后一次 append 的快照
    jest.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toEqual(
      expect.objectContaining({textChars: 3, partialText: 'abc'}),
    );
    expect(wt.hasPending()).toBe(false);

    // 无新数据不再写；新数据重新开窗
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_INTERVAL_MS * 4);
    expect(write).toHaveBeenCalledTimes(1);
    wt.append(makeRow('s', 'p', {textChars: 4, partialText: 'abcd'}));
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_INTERVAL_MS);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0]).toEqual(
      expect.objectContaining({textChars: 4, partialText: 'abcd'}),
    );
  });

  it('flush：同步发起写并清 pending（定时器不再触发第二次）；空 pending no-op', () => {
    const write = jest.fn(async () => undefined);
    const wt = createRunStateWritethrough(write);

    wt.append(makeRow('s', 'p', {partialText: 'x'}));
    wt.flush();
    // 同步发起——不依赖任何时间推进
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toEqual(
      expect.objectContaining({partialText: 'x'}),
    );
    expect(wt.hasPending()).toBe(false);

    // 定时器已取消：推进整个窗口不再有第二次写
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_SLOW_INTERVAL_MS * 2);
    expect(write).toHaveBeenCalledTimes(1);

    // 空 pending 的 flush 不产生写
    wt.flush();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('dispose：丢弃未写数据，此后 append/flush 均为僵尸 no-op（防旧写覆盖新行）', () => {
    const write = jest.fn(async () => undefined);
    const wt = createRunStateWritethrough(write);

    wt.append(makeRow('s', 'p', {partialText: '将丢弃'}));
    wt.dispose();
    expect(wt.isDisposed()).toBe(true);
    expect(write).not.toHaveBeenCalled();

    wt.flush(); // dispose 后 flush 不复活
    wt.append(makeRow('s', 'p', {partialText: '僵尸写'}));
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_SLOW_INTERVAL_MS * 2);
    expect(write).not.toHaveBeenCalled();
    expect(wt.hasPending()).toBe(false);
  });

  it('大载荷降频：单次载荷超阈值改用 1s 慢档（防写放大），载荷回落后恢复快档', () => {
    const write = jest.fn(async () => undefined);
    const wt = createRunStateWritethrough(write, {largePayloadChars: 1_000});

    // 小载荷 → 快档
    wt.append(makeRow('s', 'p', {partialText: '小'}));
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_INTERVAL_MS - 1);
    // 窗口内来了大载荷 → 升档重排：原快档到期点不写
    wt.append(
      makeRow('s', 'p', {partialText: '大'.repeat(1_001), textChars: 1_001}),
    );
    jest.advanceTimersByTime(1);
    expect(write).not.toHaveBeenCalled();
    // 慢档 1s 到期才写（重排自大载荷 append 时刻起算）
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_SLOW_INTERVAL_MS - 2);
    expect(write).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(1);

    // 载荷回落 → 下一轮恢复快档
    wt.append(makeRow('s', 'p', {partialText: '又小了'}));
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_INTERVAL_MS);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('写失败吞错：write 拒绝不外抛、不产生 unhandled rejection', async () => {
    const write = jest.fn(async () => {
      throw new Error('db closed');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const wt = createRunStateWritethrough(write);

    wt.append(makeRow('s', 'p', {partialText: 'x'}));
    wt.flush();
    wt.append(makeRow('s', 'p', {partialText: 'y'}));
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_INTERVAL_MS);
    // 冲掉微任务，确认 catch 路径收敛（无 unhandled rejection 即通过）
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});

describe('SessionStreamUnitManager 持久化接线（T-U7 / T-U12 / dispose）', () => {
  beforeEach(() => {
    setMobileAgentActive(false);
    jest.clearAllMocks();
    resetKeepAliveStateForTests();
    jest.useFakeTimers();
    jest.setSystemTime(CLOCK_START_MS);
  });

  afterEach(() => {
    jest.useRealTimers();
    setMobileAgentActive(false);
    resetKeepAliveStateForTests();
  });

  it('T-U7: 写通节流合并——250ms 内多次 delta 只一次 upsert，落盘为最后一次 append 的快照', async () => {
    const fake = createFakeRunStateStore();
    const h = createHarness({runStateStore: fake.store});
    await h.manager.hydrate();

    startRunningRun(h, 'a', 'r1');
    // 受理 starting 行 + RUN_STARTED running 行（一次性直写）
    expect(fake.upsertCallsFor('a')).toBe(2);
    expect(fake.lastUpsertFor('a')).toEqual(
      expect.objectContaining({status: 'running', runId: 'r1'}),
    );

    // 同窗口 3 次 delta → 3 次 append、1 次 upsert（快照为最后一次 append
    // 时刻：partial 尚未 apply（64ms 节拍）、指标事件即归账）
    publishTextDelta(h.eventBus, 'a', 'r1', 'Hello ');
    publishTextDelta(h.eventBus, 'a', 'r1', 'world');
    publishTextDelta(h.eventBus, 'a', 'r1', '!');
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_INTERVAL_MS - 1);
    expect(fake.upsertCallsFor('a')).toBe(2);
    jest.advanceTimersByTime(1);
    expect(fake.upsertCallsFor('a')).toBe(3);
    expect(fake.lastUpsertFor('a')).toEqual(
      expect.objectContaining({
        status: 'running',
        textChars: 12,
        partialText: null, // append 时刻 partial 未 apply，空值存 null
      }),
    );

    // 后续 delta（apply 已就位）→ 新窗口写带 partial 的快照
    publishTextDelta(h.eventBus, 'a', 'r1', ' tail');
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_INTERVAL_MS);
    expect(fake.upsertCallsFor('a')).toBe(4);
    expect(fake.lastUpsertFor('a')).toEqual(
      expect.objectContaining({
        textChars: 17,
        partialText: 'Hello world!',
      }),
    );

    // 无新数据不再写
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_SLOW_INTERVAL_MS * 2);
    expect(fake.upsertCallsFor('a')).toBe(4);
  });

  it('T-U7: step 边界立即刷——STEP_COMMITTED 同步落盘 step 边界快照（partial 已清零）', async () => {
    const fake = createFakeRunStateStore();
    const h = createHarness({runStateStore: fake.store});
    await h.manager.hydrate();

    startRunningRun(h, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', 'step1');
    // partial 就位（32+64ms），写通窗口（250ms）尚未到期
    advanceStreamTimers(0);
    publishTextDelta(h.eventBus, 'a', 'r1', '更多');
    expect(fake.upsertCallsFor('a')).toBe(2);

    // step 边界：不推进任何时间，同步产生一次 upsert
    publishStepCommitted(h.eventBus, 'a', 'r1');
    expect(fake.upsertCallsFor('a')).toBe(3);
    expect(fake.lastUpsertFor('a')).toEqual(
      expect.objectContaining({
        status: 'running',
        textChars: 7,
        // handleStepCommitted 已清 partial，append 的新快照落的是边界状态
        partialText: null,
        partialThinking: null,
        pendingChildrenJson: null,
      }),
    );

    // flush 后 pending 空：推进再长时间无重复写
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_SLOW_INTERVAL_MS * 2);
    expect(fake.upsertCallsFor('a')).toBe(3);
  });

  it('T-U7: 大载荷降频——快照超过 1MB 后写通改用 1s 档', async () => {
    const fake = createFakeRunStateStore();
    const h = createHarness({runStateStore: fake.store});
    await h.manager.hydrate();

    startRunningRun(h, 'a', 'r1');
    // 两轮 delta+apply 让 partial 超过 1MB，再发一次 delta 触发 append
    publishTextDelta(h.eventBus, 'a', 'r1', 'x'.repeat(600_000));
    advanceStreamTimers(0);
    publishTextDelta(h.eventBus, 'a', 'r1', 'y'.repeat(600_000));
    advanceStreamTimers(0);
    expect(h.manager.snapshot('a')?.partialText.length).toBeGreaterThan(
      1_000_000,
    );
    publishTextDelta(h.eventBus, 'a', 'r1', 'z');

    // 250ms 快档到期不写（已升 1s 慢档）
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_INTERVAL_MS);
    expect(fake.upsertCallsFor('a')).toBe(2);
    // 1s 慢档到期写一次
    jest.advanceTimersByTime(
      RUN_STATE_WRITETHROUGH_SLOW_INTERVAL_MS -
        RUN_STATE_WRITETHROUGH_INTERVAL_MS,
    );
    expect(fake.upsertCallsFor('a')).toBe(3);
    expect(fake.lastUpsertFor('a')?.partialText?.length).toBeGreaterThan(
      1_000_000,
    );
  });

  it('T-U7: 水合建 interrupted 单元——partial/指标/链接/startedAtMs 全恢复、无 coalescer（陈旧 delta 不产生持久层写）', async () => {
    const fake = createFakeRunStateStore();
    fake.seed(
      makeRow('s1', 'p', {
        runId: 'run-old',
        startedAtMs: 2_000,
        textChars: 123,
        thinkingChars: 45,
        partialText: '中断正文',
        partialThinking: '中断思考',
        pendingChildrenJson: '["c1","c2"]',
        updatedAtMs: 5_000,
      }),
    );
    fake.seed(makeRow('s2', 'p', {status: 'starting', runId: ''}));

    const h = createHarness({runStateStore: fake.store});
    // 构造已自动 kick 水合：完成前投影恒 null（既有语义）
    expect(h.manager.isHydrated()).toBe(false);
    expect(h.manager.snapshot('s1')).toBe(null);
    await h.manager.hydrate();
    expect(h.manager.isHydrated()).toBe(true);

    const snap = h.manager.snapshot('s1');
    expect(snap).toEqual(
      expect.objectContaining({
        status: 'interrupted',
        runId: 'run-old',
        startedAtMs: 2_000,
        settledAtMs: 5_000,
        partialText: '中断正文',
        partialThinking: '中断思考',
        metrics: {textChars: 123, thinkingChars: 45},
        pendingChildren: ['c1', 'c2'],
      }),
    );
    // starting 行同样建 interrupted 单元（受理空窗内被杀的 run）
    expect(h.manager.snapshot('s2')).toEqual(
      expect.objectContaining({status: 'interrupted', runId: ''}),
    );
    expect(h.manager.unitCount()).toBe(2);

    // 无 coalescer：陈旧 delta（runId 匹配旧 run）不生效、不产生写
    publishTextDelta(h.eventBus, 's1', 'run-old', '迟到的 delta');
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_SLOW_INTERVAL_MS * 2);
    expect(fake.upsertCallsFor('s1')).toBe(0);
    expect(h.manager.snapshot('s1')?.partialText).toBe('中断正文');
  });

  it('T-U7: 正常收尾——settle 落库（partial 清空 metrics 保留）+ settled 投影更新且不随宽限销毁清除', async () => {
    const fake = createFakeRunStateStore();
    const h = createHarness({runStateStore: fake.store});
    await h.manager.hydrate();

    startRunningRun(h, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', '正文');
    h.eventBus.publish(EVENT_AGENT_STREAM_THINKING_DELTA, {
      sessionId: 'a',
      runId: 'r1',
      text: '思考',
    });
    publishFinished(h.eventBus, 'a', 'r1');

    // settle 落库：metrics 保留、partial 三字段由服务端清空
    expect(fake.settleCallsFor('a')).toBe(1);
    const settledRow = fake.lastUpsertFor('a');
    expect(settledRow).toEqual(
      expect.objectContaining({
        status: 'settled',
        runId: 'r1',
        textChars: 2,
        thinkingChars: 2,
        partialText: null,
        partialThinking: null,
        pendingChildrenJson: null,
      }),
    );

    // settled 投影：metrics + settledAtMs + elapsedMs（「上次生成」）
    const projection = h.manager.getSettledProjection('a');
    expect(projection).not.toBe(null);
    expect(projection?.metrics).toEqual({textChars: 2, thinkingChars: 2});
    expect(projection?.settledAtMs).toBeGreaterThanOrEqual(CLOCK_START_MS);
    expect(projection?.elapsedMs).toBeGreaterThanOrEqual(0);

    // 收尾后无残留写通：coalescer 已 dispose，推进 + 陈旧 delta 都不再写
    publishTextDelta(h.eventBus, 'a', 'r1', '僵尸');
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_SLOW_INTERVAL_MS * 2);
    expect(fake.upsertCallsFor('a')).toBe(2); // 仅 starting + running
    expect(fake.settleCallsFor('a')).toBe(1);

    // 宽限到期单元销毁（snapshot 归 null），settled 投影常驻不随清除
    jest.advanceTimersByTime(TEST_SETTLED_GRACE_MS + 100);
    expect(h.manager.snapshot('a')).toBe(null);
    expect(h.manager.getSettledProjection('a')).toEqual(projection);
  });

  it('T-U7: 重启场景——新 manager 实例 + 同服务数据，settled 投影回填可读「上次生成」', async () => {
    const fake = createFakeRunStateStore();
    const first = createHarness({runStateStore: fake.store});
    await first.manager.hydrate();
    startRunningRun(first, 'a', 'r1');
    jest.advanceTimersByTime(10_000);
    publishFinished(first.eventBus, 'a', 'r1');
    const settledInFirst = first.manager.getSettledProjection('a');
    expect(settledInFirst).not.toBe(null);
    first.manager.dispose();

    // 「重启」：新 manager 实例接同一份服务数据
    const second = createHarness({runStateStore: fake.store});
    await second.manager.hydrate();
    const restored = second.manager.getSettledProjection('a');
    expect(restored).toEqual(settledInFirst);
    // 无 starting/running 行 → 不建单元（settled 不复活为 interrupted）
    expect(second.manager.unitCount()).toBe(0);
    expect(second.manager.snapshot('a')).toBe(null);
  });

  it('T-U12 完整版: interrupted 单元上 startRun——门禁不阻塞、替换吸收、无双单元、指标按新 run 重置、无旧写覆盖新行', async () => {
    const fake = createFakeRunStateStore();
    fake.seed(
      makeRow('s1', 'p', {
        runId: 'run-old',
        textChars: 123,
        thinkingChars: 45,
        partialText: '旧 run 的中断现场',
        pendingChildrenJson: '["c1"]',
        updatedAtMs: 5_000,
      }),
    );
    const h = createHarness({runStateStore: fake.store});
    await h.manager.hydrate();
    expect(h.manager.snapshot('s1')?.status).toBe('interrupted');
    const hydrateReadIndex = fake.calls.length;

    // 旧 run 已死：startRun 门禁不阻塞（interrupted 不算 active）
    h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
    const result = h.manager.startRun('s1', 'p', '再试一次');
    expect(result.ok).toBe(true);

    // 替换吸收：无双单元并存；新单元 starting、指标/partial/链接按新 run 重置
    expect(h.manager.unitCount()).toBe(1);
    expect(h.manager.snapshot('s1')).toEqual(
      expect.objectContaining({
        status: 'starting',
        runId: null,
        metrics: {textChars: 0, thinkingChars: 0},
        partialText: '',
        pendingChildren: [],
      }),
    );

    // 无旧写覆盖新行：水合读之后、s1 的第一条写就是新 run 的 starting 行
    const firstS1Write = fake.calls
      .slice(hydrateReadIndex)
      .find(call => call.sessionId === 's1');
    expect(firstS1Write?.op).toBe('upsert');
    expect(fake.lastUpsertFor('s1')).toEqual(
      expect.objectContaining({status: 'starting', runId: ''}),
    );

    // 新 run 正常推进：RUN_STARTED 覆盖为新 runId，写通照常工作
    publishStarted(h.eventBus, 's1', 'run-new');
    publishTextDelta(h.eventBus, 's1', 'run-new', '新内容');
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_INTERVAL_MS);
    expect(fake.lastUpsertFor('s1')).toEqual(
      expect.objectContaining({
        status: 'running',
        runId: 'run-new',
        textChars: 3,
      }),
    );
    // 旧 runId 的陈旧 delta 不进新单元（不写、不累积）
    publishTextDelta(h.eventBus, 's1', 'run-old', '旧写不得覆盖');
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_SLOW_INTERVAL_MS);
    expect(fake.lastUpsertFor('s1')?.runId).toBe('run-new');
  });

  it('dispose: 在途 coalescer 尽力 flush——最后快照落盘（行留 running 供水合恢复中断现场）', async () => {
    const fake = createFakeRunStateStore();
    const h = createHarness({runStateStore: fake.store});
    await h.manager.hydrate();
    startRunningRun(h, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', '崩溃前最后的内容');
    advanceStreamTimers(0); // partial 就位
    publishTextDelta(h.eventBus, 'a', 'r1', '+尾部');
    const writesBefore = fake.upsertCallsFor('a');

    h.manager.dispose(); // flush 在 dispose 内同步发起

    expect(fake.upsertCallsFor('a')).toBe(writesBefore + 1);
    expect(fake.lastUpsertFor('a')).toEqual(
      expect.objectContaining({
        status: 'running',
        // append 时刻 partial 已含「崩溃前最后的内容」（尾部 64ms 未及，
        // 写通是采样语义，尾部允许丢失）
        partialText: '崩溃前最后的内容',
      }),
    );
    // dispose 后不再有任何写
    publishTextDelta(h.eventBus, 'a', 'r1', '迟到的');
    jest.advanceTimersByTime(RUN_STATE_WRITETHROUGH_SLOW_INTERVAL_MS * 2);
    expect(fake.upsertCallsFor('a')).toBe(writesBefore + 1);
  });

  it('dispose: flush 失败吞错不阻塞（连接可能已关）', async () => {
    const fake = createFakeRunStateStore();
    fake.setFailUpsert(true);
    const h = createHarness({runStateStore: fake.store});
    await h.manager.hydrate();
    startRunningRun(h, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', 'x');

    expect(() => h.manager.dispose()).not.toThrow();
    // 冲微任务确认 catch 收敛（无 unhandled rejection 即通过）
    await Promise.resolve();
    expect(isMobileAgentActive()).toBe(false);
  });

  it('forgetSession: 销毁单元 + 清 settled 投影（供会话删除链路调用）', async () => {
    const fake = createFakeRunStateStore();
    const h = createHarness({runStateStore: fake.store});
    await h.manager.hydrate();
    startRunningRun(h, 'a', 'r1');
    publishFinished(h.eventBus, 'a', 'r1');
    expect(h.manager.getSettledProjection('a')).not.toBe(null);

    h.manager.forgetSession('a');

    expect(h.manager.unitCount()).toBe(0);
    expect(h.manager.snapshot('a')).toBe(null);
    expect(h.manager.getSettledProjection('a')).toBe(null);
    // 幂等：再次遗忘 no-op
    expect(() => h.manager.forgetSession('a')).not.toThrow();
  });

  it('forgetSession: 活跃单元被遗忘时同步 decrement，refcount 不泄漏', async () => {
    const fake = createFakeRunStateStore();
    const h = createHarness({runStateStore: fake.store});
    await h.manager.hydrate();
    startRunningRun(h, 'a', 'r1');
    expect(isMobileAgentActive()).toBe(true);

    h.manager.forgetSession('a');
    expect(isMobileAgentActive()).toBe(false);
    // 后续 FINISHED（run 实际由 core 侧终止）无单元不 decrement，防负
    publishFinished(h.eventBus, 'a', 'r1');
    expect(isMobileAgentActive()).toBe(false);
  });

  it('settled 投影被同会话新 run 收尾覆盖（不累积旧值）', async () => {
    const fake = createFakeRunStateStore();
    const h = createHarness({runStateStore: fake.store});
    await h.manager.hydrate();

    startRunningRun(h, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', 'first');
    publishFinished(h.eventBus, 'a', 'r1');
    expect(h.manager.getSettledProjection('a')?.metrics.textChars).toBe(5);

    // 新 run（旧单元宽限中被替换吸收）收尾覆盖投影
    jest.advanceTimersByTime(1_000);
    startRunningRun(h, 'a', 'r2');
    publishTextDelta(h.eventBus, 'a', 'r2', 'second-run');
    publishFinished(h.eventBus, 'a', 'r2');
    const projection = h.manager.getSettledProjection('a');
    expect(projection?.metrics.textChars).toBe(10);
    expect(projection?.metrics).toEqual({textChars: 10, thinkingChars: 0});
  });

  it('水合期间已被新 startRun 受理的会话跳过 adopt（新 run 优先于陈旧行）', async () => {
    const fake = createFakeRunStateStore();
    fake.seed(makeRow('s1', 'p', {partialText: '陈旧现场'}));
    const h = createHarness({runStateStore: fake.store});
    // 构造已 kick 水合（微任务在途），水合完成前先受理新 run
    h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
    expect(h.manager.startRun('s1', 'p', '新 run').ok).toBe(true);
    await h.manager.hydrate();

    // 新 run 单元保留（starting），未被陈旧行覆盖成 interrupted
    expect(h.manager.unitCount()).toBe(1);
    expect(h.manager.snapshot('s1')).toEqual(
      expect.objectContaining({status: 'starting'}),
    );
    expect(fake.lastUpsertFor('s1')).toEqual(
      expect.objectContaining({status: 'starting'}),
    );
  });

  it('LRU 上限约束水合 interrupted 单元（超限淘汰最旧，settled 投影不受影响）', async () => {
    const fake = createFakeRunStateStore();
    for (let i = 0; i < SESSION_STREAM_MAX_SETTLED_UNITS + 2; i += 1) {
      fake.seed(
        makeRow(`s${i}`, 'p', {
          updatedAtMs: 10_000 + i, // settledAtMs 单调，淘汰从旧到新
        }),
      );
    }
    fake.seed(
      makeRow('done', 'p', {
        status: 'settled',
        textChars: 7,
        updatedAtMs: 99_000,
      }),
    );
    const h = createHarness({runStateStore: fake.store});
    await h.manager.hydrate();

    expect(h.manager.unitCount()).toBe(SESSION_STREAM_MAX_SETTLED_UNITS);
    // 最旧的 s0/s1 被淘汰、最新的还在
    expect(h.manager.snapshot('s0')).toBe(null);
    expect(h.manager.snapshot('s1')).toBe(null);
    expect(
      h.manager.snapshot(`s${SESSION_STREAM_MAX_SETTLED_UNITS + 1}`),
    ).toEqual(expect.objectContaining({status: 'interrupted'}));
    // settled 投影独立于单元生命周期，不受 LRU 影响
    expect(h.manager.getSettledProjection('done')?.metrics.textChars).toBe(7);
  });
});
