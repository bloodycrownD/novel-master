/**
 * 会话流式单元管线测试（Step 3：事件管线/流式缓冲/单一注入/指标/pendingChildren）。
 *
 * mock 手法沿用 session-stream-unit-manager.service.test.ts 的 harness 形状
 * （SimpleEventBus + mock runtime + 注入 runAgentTurn）。fake timers 驱动
 * 32ms ingress / 64ms apply 两段缓冲节拍（setSystemTime 给定确定时钟）。
 *
 * 覆盖：
 * - T-U2：切走后事件仍消费——无 webview 句柄 attach 时 delta/step 照常
 *   累积进单元 partial/指标，收尾照常（后台会话不蒸发）；
 * - T-U3 / T-R3 / T-R4 / T-R5 等价：重进注入恰好一次（attach 两次只注
 *   一次）、step 边界后 attach 重新注入、detach 再 attach（重进）重注入；
 * - T-U4 / T-M 平移：指标语义五条（新 run 重置 / backfill+child 不重置 /
 *   结束冻结 / 切会话换源 / 连续历时）+ runId 所有权守卫；
 * - T-SUB：pendingChildren 登记/去重/同 title 覆盖/子终态不摘除（并行批
 *   窗口期任务卡须可点）/父收尾清空；
 * - T-U13：跨项目并行等价——两个不同 project 的 session 并行，事件路由/
 *   投影/收尾互不串扰。
 */
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_USAGE,
  EVENT_SUBAGENT_CHILD_SESSION_CREATED,
  SimpleEventBus,
} from '@novel-master/core/events';
import {
  isMobileAgentActive,
  setMobileAgentActive,
} from '@/runtime/agent-activity';
import {HeuristicTokenCounter} from '@novel-master/core/provider';
import {SessionStreamUnitManager} from '@/services/session-stream-unit-manager.service';
import {
  SESSION_STREAM_APPLY_INTERVAL_MS,
  SESSION_STREAM_INGRESS_COALESCE_MS,
} from '@/services/session-stream-unit';
import type {SessionStreamWebviewHandle} from '@/services/session-stream-unit';
import {createIncrementalTokenCounter} from '@novel-master/core/format';
import type {IncrementalTokenCounter} from '@novel-master/core/format';
import {resetKeepAliveStateForTests} from '@/services/agent-finished-notification';

/** 时钟起点（fake timers 的 Date.now 从此起算，断言可精确）。 */
const CLOCK_START_MS = 1_000_000;

/** 推过两段缓冲（32ms 合并 + 64ms apply）所需的全部时间。 */
function advanceStreamTimers(extraMs = 10): void {
  jest.advanceTimersByTime(
    SESSION_STREAM_INGRESS_COALESCE_MS +
      SESSION_STREAM_APPLY_INTERVAL_MS +
      extraMs,
  );
}

function createHarness(options?: {
  readonly settledGraceMs?: number;
  readonly tokenEstimatorFactory?: (
    sessionId: string,
  ) => IncrementalTokenCounter | null;
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
    settledGraceMs: options?.settledGraceMs,
    tokenEstimatorFactory: options?.tokenEstimatorFactory,
    // Step 2 水合分片的让步点注入同步 mock（fake timers 下无需真实定时器）
    yieldQuantum: async () => undefined,
  });
  manager.markHydrated();
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

function publishThinkingDelta(
  eventBus: SimpleEventBus,
  sessionId: string,
  runId: string,
  text: string,
): void {
  eventBus.publish(EVENT_AGENT_STREAM_THINKING_DELTA, {
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

function publishChildCreated(
  eventBus: SimpleEventBus,
  parentSessionId: string,
  childSessionId: string,
  title: string,
): void {
  eventBus.publish(EVENT_SUBAGENT_CHILD_SESSION_CREATED, {
    parentSessionId,
    projectId: 'p',
    childSessionId,
    title,
  });
}

/** 受理 + RUN_STARTED 回填，返回可用的 (harness, sessionId, runId)。 */
function startRunningRun(
  h: ReturnType<typeof createHarness>,
  sessionId: string,
  runId: string,
  projectId = 'p',
): void {
  h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
  expect(h.manager.startRun(sessionId, projectId, 'hi').ok).toBe(true);
  publishStarted(h.eventBus, sessionId, runId);
}

/** 记录收到的流式载荷的句柄（注入与 batch 推送都经 onStreamPayload）。 */
function createRecordingHandle(handleId: string): {
  readonly handle: SessionStreamWebviewHandle;
  readonly payloads: unknown[];
} {
  const payloads: unknown[] = [];
  return {
    handle: {
      handleId,
      onStreamPayload: payload => payloads.push(payload),
    },
    payloads,
  };
}

describe('SessionStreamUnit 事件管线（T-U2：切走后事件仍消费）', () => {
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

  it('T-U2: 无 webview 句柄 attach 时 delta/step 照常累积进 partial/指标，收尾照常', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');

    // 切走：无任何句柄 attach——delta 照常进缓冲与指标
    publishTextDelta(h.eventBus, 'a', 'r1', 'Hello ');
    publishTextDelta(h.eventBus, 'a', 'r1', 'world');
    publishThinkingDelta(h.eventBus, 'a', 'r1', 'hmm');
    jest.advanceTimersByTime(SESSION_STREAM_INGRESS_COALESCE_MS);
    jest.advanceTimersByTime(SESSION_STREAM_APPLY_INTERVAL_MS);

    const snap = h.manager.snapshot('a');
    expect(snap?.partialText).toBe('Hello world');
    expect(snap?.partialThinking).toBe('hmm');
    // heuristic 折算：ceil((11+3)/3.35) = 5
    expect(snap?.metrics).toEqual({
      textChars: 11,
      thinkingChars: 3,
      completionTokens: 5,
      tokenSource: 'heuristic',
    });
    expect(snap?.startedAtMs).toBe(CLOCK_START_MS);

    // step 边界：partial 清零（core registry 重置对齐），指标是 run 级累计不清
    publishStepCommitted(h.eventBus, 'a', 'r1');
    const afterStep = h.manager.snapshot('a');
    expect(afterStep?.partialText).toBe('');
    expect(afterStep?.partialThinking).toBe('');
    expect(afterStep?.metrics).toEqual({
      textChars: 11,
      thinkingChars: 3,
      completionTokens: 5,
      tokenSource: 'heuristic',
    });

    // 新 step 的 delta 重新累积
    publishTextDelta(h.eventBus, 'a', 'r1', 'next');
    advanceStreamTimers();
    expect(h.manager.snapshot('a')?.partialText).toBe('next');

    // 收尾照常：后台会话不蒸发
    publishFinished(h.eventBus, 'a', 'r1');
    const settled = h.manager.snapshot('a');
    expect(settled?.status).toBe('finished');
    expect(settled?.elapsedMs).not.toBeNull();
    expect(isMobileAgentActive()).toBe(false);
  });

  it('T-U2: 指标在事件到达即归账（不经缓冲节拍），partial 走 apply 节拍', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');

    publishTextDelta(h.eventBus, 'a', 'r1', 'abc');
    // 尚未推进任何定时器：指标已可见，partial 还在缓冲里
    expect(h.manager.snapshot('a')?.metrics.textChars).toBe(3);
    expect(h.manager.snapshot('a')?.partialText).toBe('');

    advanceStreamTimers();
    expect(h.manager.snapshot('a')?.partialText).toBe('abc');
  });

  it('T-U2: 收尾（settle）前同步冲刷缓冲——未到达 apply 节拍的 delta 不丢', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');

    publishTextDelta(h.eventBus, 'a', 'r1', 'tail ');
    publishTextDelta(h.eventBus, 'a', 'r1', 'chunk');
    // 不推进定时器，直接 FINISHED：settle 内部先冲刷两段缓冲
    publishFinished(h.eventBus, 'a', 'r1');

    const settled = h.manager.snapshot('a');
    expect(settled?.status).toBe('finished');
    expect(settled?.partialText).toBe('tail chunk');
    expect(settled?.metrics.textChars).toBe(10);
  });

  it('runId 不符的 delta（陈旧事件）不进缓冲、不计指标', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');

    publishTextDelta(h.eventBus, 'a', 'r-stale', 'zzz');
    advanceStreamTimers();
    const snap = h.manager.snapshot('a');
    expect(snap?.partialText).toBe('');
    expect(snap?.metrics.textChars).toBe(0);
  });

  it('starting 态（RUN_STARTED 未达）的 delta 忽略；同 runId 重复 STARTED 不重置', () => {
    const h = createHarness();
    h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
    expect(h.manager.startRun('a', 'p', 'hi').ok).toBe(true);

    // 受理空窗内到达的 delta（理论乱序，防御）：无 runId 所有权，忽略
    publishTextDelta(h.eventBus, 'a', 'r1', 'early');
    advanceStreamTimers();
    expect(h.manager.snapshot('a')?.partialText).toBe('');
    expect(h.manager.snapshot('a')?.metrics.textChars).toBe(0);

    publishStarted(h.eventBus, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', 'abc');
    advanceStreamTimers();
    const startedAt = h.manager.snapshot('a')?.startedAtMs;

    // 同 runId 重复 STARTED（真机回填双发）：markRunning 被状态守卫拒绝，不重置
    publishStarted(h.eventBus, 'a', 'r1');
    const snap = h.manager.snapshot('a');
    expect(snap?.startedAtMs).toBe(startedAt);
    expect(snap?.metrics.textChars).toBe(3);
  });

  it('投影通知跟随 apply 节拍（≈64ms）而非 delta 频率', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');
    const notified: number[] = [];
    h.manager.subscribe(() => notified.push(Date.now()));

    publishTextDelta(h.eventBus, 'a', 'r1', 'a');
    publishTextDelta(h.eventBus, 'a', 'r1', 'b');
    publishTextDelta(h.eventBus, 'a', 'r1', 'c');
    expect(notified).toHaveLength(0); // ingress 阶段不通知

    advanceStreamTimers();
    expect(notified).toHaveLength(1); // 三段合并成一次 apply 通知
  });
});

describe('单一注入实现（T-U3：重进注入恰好一次 + step 边界重注入）', () => {
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

  it('T-U3/T-R3: attach 即注入本 step 已累积的 partial（text/thinking 各一条 stream-delta）', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', '正文 partial');
    publishThinkingDelta(h.eventBus, 'a', 'r1', '思考 partial');
    advanceStreamTimers();

    const w1 = createRecordingHandle('w1');
    h.manager.attachWebview('a', w1.handle);
    expect(w1.payloads).toEqual([
      {type: 'stream-delta', kind: 'text', delta: '正文 partial'},
      {type: 'stream-delta', kind: 'thinking', delta: '思考 partial'},
    ]);
    expect(h.manager.snapshot('a')?.injected).toBe(true);
  });

  it('T-U3: attach 两次（无 detach）只注一次；流式推送只给最后 attach 的句柄', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', 'body');
    advanceStreamTimers();

    const w1 = createRecordingHandle('w1');
    h.manager.attachWebview('a', w1.handle);
    expect(w1.payloads).toHaveLength(1);

    // 第二个句柄 attach（w1 未 detach）：本 step 已注入过，不再注入
    const w2 = createRecordingHandle('w2');
    h.manager.attachWebview('a', w2.handle);
    expect(w2.payloads).toEqual([]);

    // 注入后的新 delta 经合并以 stream-batch 推给「最后 attach」的 w2
    publishTextDelta(h.eventBus, 'a', 'r1', ' more');
    advanceStreamTimers();
    expect(w1.payloads).toHaveLength(1); // w1 不再收流式
    expect(w2.payloads).toEqual([
      {type: 'stream-batch', segments: [{kind: 'text', delta: ' more'}]},
    ]);
  });

  it('T-U3/T-R4: step 边界后 attach 重新注入，且只含新 step 的累积', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', 'step1-body');
    advanceStreamTimers();

    const w1 = createRecordingHandle('w1');
    h.manager.attachWebview('a', w1.handle);
    expect(w1.payloads).toEqual([
      {type: 'stream-delta', kind: 'text', delta: 'step1-body'},
    ]);

    // step 提交：注入标记复位（蓝本 resetInjection）
    publishStepCommitted(h.eventBus, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', 'step2-body');
    advanceStreamTimers();

    const w2 = createRecordingHandle('w2');
    h.manager.attachWebview('a', w2.handle);
    expect(w2.payloads).toEqual([
      {type: 'stream-delta', kind: 'text', delta: 'step2-body'},
    ]);
    // 新注入不含上一 step 的内容（partial 已在 step 边界清零）
    const injections = [w1.payloads, w2.payloads]
      .flat()
      .filter(
        payload =>
          typeof payload === 'object' &&
          payload != null &&
          (payload as {type?: string}).type === 'stream-delta',
      );
    expect(injections).toHaveLength(2);
  });

  it('T-R5 等价: 同一会话反复重进（detach → attach）每次都重新注入', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', 'abc');
    advanceStreamTimers();

    // 第一次进入
    const first = createRecordingHandle('w-first');
    h.manager.attachWebview('a', first.handle);
    expect(first.payloads).toHaveLength(1);

    // 切走（句柄摘除）→ 标记复位；切回重新挂 → 重新注入
    h.manager.detachWebview('a', 'w-first');
    const second = createRecordingHandle('w-second');
    h.manager.attachWebview('a', second.handle);
    expect(second.payloads).toEqual([
      {type: 'stream-delta', kind: 'text', delta: 'abc'},
    ]);

    // 第三次重进仍注入（标记不残留）
    h.manager.detachWebview('a', 'w-second');
    const third = createRecordingHandle('w-third');
    h.manager.attachWebview('a', third.handle);
    expect(third.payloads).toHaveLength(1);
  });

  it('partial 为空时 attach 不注入；后续 delta 直接以流式推送到达', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');

    const w1 = createRecordingHandle('w1');
    h.manager.attachWebview('a', w1.handle);
    expect(w1.payloads).toEqual([]);
    expect(h.manager.snapshot('a')?.injected).toBe(false);

    publishTextDelta(h.eventBus, 'a', 'r1', 'live');
    advanceStreamTimers();
    expect(w1.payloads).toEqual([
      {type: 'stream-batch', segments: [{kind: 'text', delta: 'live'}]},
    ]);
  });

  it('run 结束（settled）后 attach 不注入——落库消息接管', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', 'done-body');
    advanceStreamTimers();
    publishFinished(h.eventBus, 'a', 'r1');

    const w1 = createRecordingHandle('w1');
    h.manager.attachWebview('a', w1.handle);
    expect(w1.payloads).toEqual([]);
  });

  it('注入只经定向 stream-delta 载荷：不可见的中间句柄不受影响', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', 'x');
    advanceStreamTimers();

    const hiddenPayloads: unknown[] = [];
    h.manager.attachWebview('a', {
      handleId: 'hidden',
      isVisible: () => false,
      onStreamPayload: payload => hiddenPayloads.push(payload),
    });
    // 不可见句柄 attach 也注入（注入是定向的，不受可见性约束），
    // 但后续流式推送只找「最后 attach 的可见句柄」——这里没有 → 落空
    expect(hiddenPayloads).toEqual([
      {type: 'stream-delta', kind: 'text', delta: 'x'},
    ]);
    publishTextDelta(h.eventBus, 'a', 'r1', 'y');
    advanceStreamTimers();
    expect(hiddenPayloads).toHaveLength(1);
    expect(h.manager.snapshot('a')?.partialText).toBe('xy');
  });
});

describe('指标语义（T-U4 五条 + T-M 平移）', () => {
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

  it('T-U4-1: 新 run 重置——同会话再发起，指标/partial/历时全部回到零值', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', 'abcdef');
    advanceStreamTimers();
    publishFinished(h.eventBus, 'a', 'r1');
    expect(h.manager.snapshot('a')?.metrics.textChars).toBe(6);

    // settled 单元被 startRun 替换吸收：新单元除计时起点外天然零值
    // （起点随受理置位——starting 阶段指标条即显示）
    h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
    expect(h.manager.startRun('a', 'p', 'again').ok).toBe(true);
    const starting = h.manager.snapshot('a');
    expect(starting?.status).toBe('starting');
    expect(starting?.metrics).toEqual({
      textChars: 0,
      thinkingChars: 0,
      completionTokens: 0,
      tokenSource: 'heuristic',
    });
    expect(starting?.startedAtMs).toBeGreaterThan(0);
    expect(starting?.elapsedMs).toBe(null);
    expect(starting?.partialText).toBe('');
    expect(starting?.partialThinking).toBe('');
    expect(starting?.injected).toBe(false);
    expect(starting?.pendingChildren).toEqual([]);
  });

  it('T-U4-6: 受理即置计时起点，RUN_STARTED 回填不重置', () => {
    const h = createHarness();
    h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
    expect(h.manager.startRun('a', 'p', 'r1').ok).toBe(true);
    const beginAt = h.manager.snapshot('a')?.startedAtMs;
    // starting 阶段（事件未回填）指标条即有起点——用户请求时刻起算
    expect(beginAt).toBeGreaterThan(0);

    jest.advanceTimersByTime(1_000);
    publishStarted(h.eventBus, 'a', 'r1');
    // 回填只迁移状态不重置起点：起点保持受理时刻（用户感知口径），
    // 连续计时不从零的语义不受影响
    expect(h.manager.snapshot('a')?.startedAtMs).toBe(beginAt);
  });

  it('T-U4-2: 重复 STARTED（同 runId 回填）与 child 事件不重置指标', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', 'abc');
    advanceStreamTimers();
    const before = h.manager.snapshot('a');

    publishStarted(h.eventBus, 'a', 'r1'); // 回填双发
    publishChildCreated(h.eventBus, 'a', 'c1', '任务一');
    publishStepCommitted(h.eventBus, 'a', 'r1');

    const after = h.manager.snapshot('a');
    expect(after?.metrics).toEqual({
      textChars: 3,
      thinkingChars: 0,
      completionTokens: 1, // ceil(3/3.35)
      tokenSource: 'heuristic',
    });
    expect(after?.startedAtMs).toBe(before?.startedAtMs);
  });

  it('T-U4-3: 结束冻结——elapsedMs 定格，settled 后到达的 delta 不再计入', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', 'abc');

    // 不推进 apply 定时器：settle 会同步冲刷，elapsed 恰为推进量
    jest.advanceTimersByTime(5000);
    publishFinished(h.eventBus, 'a', 'r1');
    const settled = h.manager.snapshot('a');
    expect(settled?.elapsedMs).toBe(5000);
    expect(settled?.metrics).toEqual({
      textChars: 3,
      thinkingChars: 0,
      completionTokens: 1,
      tokenSource: 'heuristic',
    });
    expect(settled?.partialText).toBe('abc'); // settle 冲刷落地

    // 收尾后同 runId 的迟到 delta：状态守卫拒绝，指标不再增长
    publishTextDelta(h.eventBus, 'a', 'r1', 'late');
    advanceStreamTimers();
    const frozen = h.manager.snapshot('a');
    expect(frozen?.metrics).toEqual({
      textChars: 3,
      thinkingChars: 0,
      completionTokens: 1,
      tokenSource: 'heuristic',
    });
    expect(frozen?.elapsedMs).toBe(5000);
  });

  it('T-U4-4: 切会话换源——两 session 并行，指标/partial 投影互不串', () => {
    const h = createHarness();
    startRunningRun(h, 'sA', 'rA');
    startRunningRun(h, 'sB', 'rB');

    publishTextDelta(h.eventBus, 'sA', 'rA', 'aaa');
    publishTextDelta(h.eventBus, 'sB', 'rB', 'bb');
    publishThinkingDelta(h.eventBus, 'sA', 'rA', 'cc');
    advanceStreamTimers();

    const snapA = h.manager.snapshot('sA');
    const snapB = h.manager.snapshot('sB');
    expect(snapA?.metrics).toEqual({
      textChars: 3,
      thinkingChars: 2,
      completionTokens: 2, // ceil(5/3.35)
      tokenSource: 'heuristic',
    });
    expect(snapB?.metrics).toEqual({
      textChars: 2,
      thinkingChars: 0,
      completionTokens: 1, // ceil(2/3.35)
      tokenSource: 'heuristic',
    });
    expect(snapA?.partialText).toBe('aaa');
    expect(snapB?.partialText).toBe('bb');

    // 陈旧 finish（runId 不符）不动在途 run 的指标
    publishFinished(h.eventBus, 'sA', 'r-other');
    expect(h.manager.snapshot('sA')?.status).toBe('running');
    expect(h.manager.snapshot('sA')?.metrics.textChars).toBe(3);
  });

  it('T-U4-5: 连续历时——run 进行中多次查看投影，startedAtMs 保持不变', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');
    const startedAt = h.manager.snapshot('a')?.startedAtMs;

    // 会话切换/重进不触发任何重置：时间推进 + 持续 delta
    jest.advanceTimersByTime(1200);
    publishTextDelta(h.eventBus, 'a', 'r1', 'more');
    advanceStreamTimers();
    expect(h.manager.snapshot('a')?.startedAtMs).toBe(startedAt);
    expect(h.manager.snapshot('a')?.startedAtMs).toBe(CLOCK_START_MS);
  });
});

describe('子会话链接 pendingChildren（T-SUB）', () => {
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

  it('T-SUB: child-created 登记进父单元投影（插入序）', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');

    publishChildCreated(h.eventBus, 'a', 'c1', '任务一');
    publishChildCreated(h.eventBus, 'a', 'c2', '任务二');
    expect(h.manager.snapshot('a')?.pendingChildren).toEqual(['c1', 'c2']);
  });

  it('T-SUB: 去重——同 childSessionId 重复登记不重复入投影', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');

    publishChildCreated(h.eventBus, 'a', 'c1', '任务一');
    publishChildCreated(h.eventBus, 'a', 'c1', '任务一（重发）');
    expect(h.manager.snapshot('a')?.pendingChildren).toEqual(['c1']);
  });

  it('T-SUB: 同 title 覆盖——新 child 接管，旧 child 无归属则摘除', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');

    publishChildCreated(h.eventBus, 'a', 'c1', '同题任务');
    publishChildCreated(h.eventBus, 'a', 'c2', '同题任务');
    expect(h.manager.snapshot('a')?.pendingChildren).toEqual(['c2']);
  });

  it('T-SUB: 子会话 run 终态（FINISHED/FAILED）不摘除父单元链接（父收尾才清空）', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');
    publishChildCreated(h.eventBus, 'a', 'c1', '任务一');
    publishChildCreated(h.eventBus, 'a', 'c2', '任务二');
    expect(h.manager.snapshot('a')?.pendingChildren).toEqual(['c1', 'c2']);

    // 子会话自己的 run 结束：sessionId 是子会话 id——并行 task 批整批
    // fork-join，tool_results（含 meta.subagentSessionId）要等最慢子 agent
    // 完成才落库；窗口期里 pending 映射是任务卡唯一可点数据源，不摘除
    publishFinished(h.eventBus, 'c1', 'child-run-1');
    expect(h.manager.snapshot('a')?.pendingChildren).toEqual(['c1', 'c2']);
    expect(h.manager.snapshot('a')?.status).toBe('running'); // 父不受影响

    publishFailed(h.eventBus, 'c2', 'child-run-2');
    expect(h.manager.snapshot('a')?.pendingChildren).toEqual(['c1', 'c2']);
    expect(h.manager.snapshot('a')?.status).toBe('running');

    // 父 run 收尾统一清空：落库 result meta 接管任务卡可点性
    publishFinished(h.eventBus, 'a', 'r1');
    expect(h.manager.snapshot('a')?.pendingChildren).toEqual([]);
    expect(h.manager.snapshot('a')?.pendingChildrenByTitle.size).toBe(0);
  });

  it('T-SUB 回归: 并行两个子会话 run，先完成者的映射活到父 run 收尾', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');
    publishChildCreated(h.eventBus, 'a', 'c1', '任务一');
    publishChildCreated(h.eventBus, 'a', 'c2', '任务二');
    // 子会话各自 RUN_STARTED：manager lazy 建消费型单元（贴近真实并行 task）
    publishStarted(h.eventBus, 'c1', 'child-run-1');
    publishStarted(h.eventBus, 'c2', 'child-run-2');

    // 第一个子 agent 完成、批未整体结束：title→child 映射两者俱在——
    // 卡片可点性由 pending 映射承担，直到 tool_results 整批落库
    publishFinished(h.eventBus, 'c1', 'child-run-1');
    const mid = h.manager.snapshot('a');
    expect(mid?.pendingChildren).toEqual(['c1', 'c2']);
    expect(mid?.pendingChildrenByTitle.get('任务一')).toBe('c1');
    expect(mid?.pendingChildrenByTitle.get('任务二')).toBe('c2');
    expect(mid?.status).toBe('running');

    // 父 run 收尾（fork-join 结束、tool_results 落库后）：映射清空，
    // 任务卡交给 result meta.subagentSessionId
    publishFinished(h.eventBus, 'a', 'r1');
    const settled = h.manager.snapshot('a');
    expect(settled?.pendingChildren).toEqual([]);
    expect(settled?.pendingChildrenByTitle.size).toBe(0);
    expect(settled?.status).toBe('finished');
  });

  it('T-SUB: 父收尾清空全部链接（防同 title 陈旧条目串到下一 run）', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');
    publishChildCreated(h.eventBus, 'a', 'c1', '任务一');
    publishChildCreated(h.eventBus, 'a', 'c2', '任务二');

    publishFinished(h.eventBus, 'a', 'r1');
    expect(h.manager.snapshot('a')?.pendingChildren).toEqual([]);
  });

  it('T-SUB: 无父单元的 child-created 静默 no-op', () => {
    const h = createHarness();
    publishChildCreated(h.eventBus, 'ghost', 'c1', '任务');
    expect(h.manager.snapshot('ghost')).toBe(null);
  });

  it('T-SUB: 单元销毁（宽限到期）后反查条目一并清理，子终态不复活', () => {
    const h = createHarness({settledGraceMs: 1000});
    startRunningRun(h, 'a', 'r1');
    publishChildCreated(h.eventBus, 'a', 'c1', '任务一');
    publishFinished(h.eventBus, 'a', 'r1');
    expect(h.manager.snapshot('a')?.pendingChildren).toEqual([]);

    // 宽限到期单元销毁出表
    jest.advanceTimersByTime(1000);
    expect(h.manager.snapshot('a')).toBe(null);

    // 迟到的子终态事件：反查条目已随父收尾/单元出表清理，不抛错、不复活
    publishFinished(h.eventBus, 'c1', 'child-run-1');
    expect(h.manager.snapshot('a')).toBe(null);
  });
});

describe('T-U13: 跨项目并行等价', () => {
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

  it('两个不同 project 的 session 并行：事件路由/投影/收尾互不串扰', () => {
    const h = createHarness();
    startRunningRun(h, 'sa', 'r1', 'p1');
    startRunningRun(h, 'sb', 'r2', 'p2');
    expect(isMobileAgentActive()).toBe(true);

    // 交错事件：delta/step/child 各自按 sessionId 路由
    publishTextDelta(h.eventBus, 'sa', 'r1', 'alpha');
    publishTextDelta(h.eventBus, 'sb', 'r2', 'beta');
    publishThinkingDelta(h.eventBus, 'sa', 'r1', 'aa');
    publishChildCreated(h.eventBus, 'sa', 'ca', '任务A');
    publishChildCreated(h.eventBus, 'sb', 'cb', '任务B');
    advanceStreamTimers();

    const snapA = h.manager.snapshot('sa');
    const snapB = h.manager.snapshot('sb');
    expect(snapA?.projectId).toBe('p1');
    expect(snapB?.projectId).toBe('p2');
    expect(snapA?.metrics).toEqual({
      textChars: 5,
      thinkingChars: 2,
      completionTokens: 3, // ceil(7/3.35)
      tokenSource: 'heuristic',
    });
    expect(snapB?.metrics).toEqual({
      textChars: 4,
      thinkingChars: 0,
      completionTokens: 2, // ceil(4/3.35)
      tokenSource: 'heuristic',
    });
    expect(snapA?.pendingChildren).toEqual(['ca']);
    expect(snapB?.pendingChildren).toEqual(['cb']);

    // webview 句柄各自 attach：注入互不串
    const wa = createRecordingHandle('wa');
    const wb = createRecordingHandle('wb');
    h.manager.attachWebview('sa', wa.handle);
    h.manager.attachWebview('sb', wb.handle);
    expect(wa.payloads).toEqual([
      {type: 'stream-delta', kind: 'text', delta: 'alpha'},
      {type: 'stream-delta', kind: 'thinking', delta: 'aa'},
    ]);
    expect(wb.payloads).toEqual([
      {type: 'stream-delta', kind: 'text', delta: 'beta'},
    ]);

    // sa 的 step 边界只影响 sa
    publishStepCommitted(h.eventBus, 'sa', 'r1');
    expect(h.manager.snapshot('sa')?.partialText).toBe('');
    expect(h.manager.snapshot('sb')?.partialText).toBe('beta');

    // sa 收尾不影响 sb；sa 的子链接清空、sb 的保留
    publishFinished(h.eventBus, 'sa', 'r1');
    expect(h.manager.snapshot('sa')?.status).toBe('finished');
    expect(h.manager.snapshot('sa')?.pendingChildren).toEqual([]);
    expect(h.manager.snapshot('sb')?.status).toBe('running');
    expect(h.manager.snapshot('sb')?.pendingChildren).toEqual(['cb']);
    expect(isMobileAgentActive()).toBe(true); // sb 仍在跑

    // sb 后续 delta 照常进自己单元
    publishTextDelta(h.eventBus, 'sb', 'r2', '!');
    advanceStreamTimers();
    expect(h.manager.snapshot('sb')?.partialText).toBe('beta!');

    publishFinished(h.eventBus, 'sb', 'r2');
    expect(h.manager.snapshot('sb')?.status).toBe('finished');
    expect(isMobileAgentActive()).toBe(false);
  });

  it('并行期间 per-session 门禁只拦自己的会话', () => {
    const h = createHarness();
    startRunningRun(h, 'sa', 'r1', 'p1');
    startRunningRun(h, 'sb', 'r2', 'p2');

    // sa 在跑：sa 的重复发起被拒，sb 的再发起也被拒（各自门禁），
    // 但第三个会话不受任何影响
    expect(h.manager.startRun('sa', 'p1', 'again').ok).toBe(false);
    expect(h.manager.startRun('sc', 'p3', 'fresh').ok).toBe(true);
  });
});

describe('step 边界 reset-stream 广播（1.5.18 渲染错段回归修复）', () => {
  it('STEP_COMMITTED 冲刷后向句柄广播 reset-stream，webview 尾巴随之整体重置', () => {
    const h = createHarness();
    startRunningRun(h, 's1', 'r1');
    const controls: unknown[] = [];
    h.manager.attachWebview(
      's1',
      (() => {
        const handle: SessionStreamWebviewHandle = {
          handleId: 'web-reset',
          isVisible: () => true,
          onStreamPayload: () => undefined,
          onControlMessage: (m: unknown) => {
            controls.push(m);
          },
        };
        return handle;
      })(),
    );

    publishTextDelta(h.eventBus, 's1', 'r1', 'step1 text');
    advanceStreamTimers();
    publishStepCommitted(h.eventBus, 's1', 'r1');

    // 尾巴重置广播必须与 partial 清零同边界发出，否则下一 step 的
    // thinking/text 追加进上一 step 残留尾巴（正文/思考交替错段）。
    expect(controls).toContainEqual({type: 'reset-stream'});
  });

  it('runId 不匹配或非 running 态的陈旧 STEP_COMMITTED 不广播', () => {
    const h = createHarness();
    startRunningRun(h, 's1', 'r1');
    const controls: unknown[] = [];
    h.manager.attachWebview(
      's1',
      (() => {
        const handle: SessionStreamWebviewHandle = {
          handleId: 'web-stale',
          isVisible: () => true,
          onStreamPayload: () => undefined,
          onControlMessage: (m: unknown) => {
            controls.push(m);
          },
        };
        return handle;
      })(),
    );

    publishStepCommitted(h.eventBus, 's1', 'other-run');
    expect(controls).toEqual([]);
  });
});

describe('settled 旧单元替换吸收：句柄迁移（HANDLE-NULL 回归）', () => {
  it('宽限中的旧单元被替换吸收时，已挂句柄转挂给新单元，流式推送不断流', () => {
    const h = createHarness();
    // 第一轮 run：起流 → 收尾进宽限（settled 单元仍在注册表）
    startRunningRun(h, 's1', 'r1');
    const payloads: unknown[] = [];
    h.manager.attachWebview(
      's1',
      (() => {
        const handle: SessionStreamWebviewHandle = {
          handleId: 'web-migrate',
          isVisible: () => true,
          onStreamPayload: (p: unknown) => {
            payloads.push(p);
          },
        };
        return handle;
      })(),
    );
    publishTextDelta(h.eventBus, 's1', 'r1', 'step text');
    advanceStreamTimers();
    eventBusSettle(h, 's1', 'r1');

    // 第二轮 run：替换吸收 settled 旧单元——句柄必须迁移，
    // 否则新单元全程无句柄（会话内不渲染，重进注入才可见）。
    expect(h.manager.startRun('s1', 'p', 'again').ok).toBe(true);
    publishStarted(h.eventBus, 's1', 'r2');
    publishTextDelta(h.eventBus, 's1', 'r2', 'second run text');
    // settle 前的同步冲刷绕过定时器节拍（T-U2 收尾冲刷手法），直达
    // applyStreamSegments → pushStreamPayload——句柄迁移是否生效一步定案。
    eventBusSettle(h, 's1', 'r2');

    const pushed = payloads.filter(
      p => (p as {type?: string}).type === 'stream-batch',
    );
    expect(pushed.length).toBeGreaterThan(0);
    expect(
      pushed.some(p =>
        JSON.stringify(p).includes('second run text'),
      ),
    ).toBe(true);
  });
});

/** 收尾第一轮 run（FINISHED 事件驱动 settle，进宽限保留注册表）。 */
function eventBusSettle(
  h: ReturnType<typeof createHarness>,
  sessionId: string,
  runId: string,
): void {
  h.eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
    sessionId,
    projectId: 'p',
    runId,
    success: true,
  });
}

/** 发布 usage 事件（completionTokens 为 run 级累计，source 恒 usage）。 */
function publishUsage(
  eventBus: SimpleEventBus,
  sessionId: string,
  runId: string,
  completionTokens: number,
): void {
  eventBus.publish(EVENT_AGENT_STREAM_USAGE, {
    sessionId,
    runId,
    completionTokens,
    source: 'usage',
  });
}

describe('token 化指标（T-M5/T-M7）', () => {
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

  it('T-M7: heuristic 按累计字符长度取 ceil——逐 delta 更新与 HeuristicTokenCounter.countText 全量计数严格一致', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');

    // 分多条 delta（含正文/思考交替）逐次核对折算值。
    const chunks = ['abc', '中文内容', 'de', '更多思考'];
    let textLen = 0;
    let thinkingLen = 0;
    chunks.forEach((chunk, index) => {
      if (index % 2 === 0) {
        publishTextDelta(h.eventBus, 'a', 'r1', chunk);
        textLen += chunk.length;
      } else {
        publishThinkingDelta(h.eventBus, 'a', 'r1', chunk);
        thinkingLen += chunk.length;
      }
      const metrics = h.manager.snapshot('a')?.metrics;
      expect(metrics?.tokenSource).toBe('heuristic');
      expect(metrics?.completionTokens).toBe(
        Math.ceil((textLen + thinkingLen) / 3.35),
      );
    });

    // 与全量计数严格一致（单次 countText 口径，非逐 delta 浮点累加）。
    const counter = new HeuristicTokenCounter();
    expect(h.manager.snapshot('a')?.metrics.completionTokens).toBe(
      counter.countText('x'.repeat(textLen + thinkingLen)),
    );
  });

  it('T-M5: usage 重锚基线、source 翻转；其后 delta 的增量继续叠加（run 级累计不冻结）', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');

    publishTextDelta(h.eventBus, 'a', 'r1', 'abcdef');
    expect(h.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 2, tokenSource: 'heuristic'}),
    );

    // usage 事件（run 级累计真值）到达：重锚基线 → 读值 = 真值。
    publishUsage(h.eventBus, 'a', 'r1', 999);
    expect(h.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 999, tokenSource: 'usage'}),
    );

    // 后续 delta 继续叠加增量（基线 997 + ceil(10/3.35)=3 → 1000）：不再被
    // 「真值后 heuristic 不回写」的门拦死（①多步 run 冻结缺陷的修复点）。
    publishTextDelta(h.eventBus, 'a', 'r1', 'ghij');
    expect(h.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 1000, tokenSource: 'usage'}),
    );

    // step 边界：token 与字数同为 run 级累计，不清零。
    publishStepCommitted(h.eventBus, 'a', 'r1');
    expect(h.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 1000, tokenSource: 'usage'}),
    );

    // 第二条 usage（多 step 累计真值）到达：重锚到新真值，此后继续叠加
    // （基线 1231 + ceil(11/3.35)=4 → 1235）。
    publishUsage(h.eventBus, 'a', 'r1', 1234);
    expect(h.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 1234, tokenSource: 'usage'}),
    );
    publishTextDelta(h.eventBus, 'a', 'r1', '一');
    expect(h.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 1235, tokenSource: 'usage'}),
    );
  });

  it('T-M5 多步 run：工具 step 静默后第二步文本流 token 继续增长，终态速率段不消失（①回归）', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');

    // step 1：每 250ms 一条 50 字符 delta（每拍 +15 t ≈ 60 tok/s）。
    for (let i = 0; i < 5; i += 1) {
      publishTextDelta(h.eventBus, 'a', 'r1', 'x'.repeat(50));
      jest.advanceTimersByTime(250);
    }
    publishStepCommitted(h.eventBus, 'a', 'r1');
    // step 1 done：runner 补发 run 级 usage 真值。
    publishUsage(h.eventBus, 'a', 'r1', 600);
    expect(h.manager.snapshot('a')?.metrics.completionTokens).toBe(600);

    // 工具 step：无文本 delta（mobile 不订阅 tool-use 事件），静默 3s——
    // 超过 2.5s 速率窗口，旧样本折叠出窗。
    jest.advanceTimersByTime(3_000);

    // 第二步文本流首个 delta：token 必须继续增长（旧实现冻结在 600）。
    publishTextDelta(h.eventBus, 'a', 'r1', 'y'.repeat(50));
    const afterSecondStepFirstDelta = h.manager.snapshot('a')!.metrics;
    expect(afterSecondStepFirstDelta.completionTokens).toBeGreaterThan(600);
    expect(afterSecondStepFirstDelta.tokenSource).toBe('usage');

    // 第二步继续流式输出（每 250ms +50 字符），新窗口重新成形。
    for (let i = 0; i < 4; i += 1) {
      jest.advanceTimersByTime(250);
      publishTextDelta(h.eventBus, 'a', 'r1', 'y'.repeat(50));
    }
    expect(h.manager.snapshot('a')!.metrics.completionTokens).toBeGreaterThan(
      600,
    );
    expect(h.manager.rateTokensPerSecond('a', Date.now())).not.toBeNull();

    // 收尾：终态速率段必须存在（旧实现 freeze 折叠成单样本 → null /
    // 第一步陈速率）。
    publishFinished(h.eventBus, 'a', 'r1');
    const projection = h.manager.getSettledProjection('a');
    expect(projection).not.toBeNull();
    expect(projection!.rateTokensPerSecond).not.toBeNull();
    expect(projection!.metrics.completionTokens).toBeGreaterThan(600);

    h.manager.dispose();
  });

  it('②注入估算器：token 由估算器给出（非字符折算），usage 重锚后增量继续叠加', () => {
    // 假估算器：1 字符 = 1 token（与 ceil(chars/3.35) 可区分）；每条通道
    // 一条独立实例（正文/思考分别累计）。
    const createFakeEstimator = (): IncrementalTokenCounter => {
      let text = '';
      return {
        push(delta: string) {
          text += delta;
        },
        get tokens() {
          return text.length;
        },
        // 接口的必填诊断字段（core B-1 改法 #6）：假计数器不真的计数。
        get unencodableChars() {
          return 0;
        },
        reset() {
          text = '';
        },
      };
    };
    const h = createHarness({tokenEstimatorFactory: () => createFakeEstimator()});
    startRunningRun(h, 'a', 'r1');

    // 正文 4 字符 → 估算 4 t（启发式会是 2 t）。
    publishTextDelta(h.eventBus, 'a', 'r1', 'abcd');
    expect(h.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 4, tokenSource: 'heuristic'}),
    );
    // 思考通道独立累计：2 字符 → 合计 6 t。
    publishThinkingDelta(h.eventBus, 'a', 'r1', 'ab');
    expect(h.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 6, tokenSource: 'heuristic'}),
    );

    // usage 重锚：基线 = 100 − 6 = 94。
    publishUsage(h.eventBus, 'a', 'r1', 100);
    expect(h.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 100, tokenSource: 'usage'}),
    );
    // 后续 delta：估算增量继续叠加（正文 8 → 94+8+2 = 104）。
    publishTextDelta(h.eventBus, 'a', 'r1', 'efgh');
    expect(h.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 104, tokenSource: 'usage'}),
    );
    // 第二条 usage 重锚后仍连续（500 → 后续 delta 501，不回退不冻结）。
    publishUsage(h.eventBus, 'a', 'r1', 500);
    publishTextDelta(h.eventBus, 'a', 'r1', 'i');
    expect(h.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 501, tokenSource: 'usage'}),
    );

    h.manager.dispose();
  });

  it('T-M5 openai 场景：流中零 usage 事件段 heuristic 撑显示，step done 补发的终值事件到达即校正', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');

    // openai 流中零事件段：heuristic 估算撑住显示（ceil(13/3.35)=4）。
    publishTextDelta(h.eventBus, 'a', 'r1', 'step one body');
    expect(h.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 4, tokenSource: 'heuristic'}),
    );
    publishStepCommitted(h.eventBus, 'a', 'r1');

    // step done 后 runner 补发的 run 级终值事件（同一 ingestUsage 管线）：
    // 重锚到真值（校正链闭环不依赖 FINISHED）。
    publishUsage(h.eventBus, 'a', 'r1', 87);
    expect(h.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 87, tokenSource: 'usage'}),
    );
  });

  it('T-M5: 陈旧 usage 事件（runId 不符 / 非 running 态）不计指标', () => {
    const h = createHarness();
    startRunningRun(h, 'a', 'r1');
    publishTextDelta(h.eventBus, 'a', 'r1', 'abc');

    // runId 不符：整体忽略。
    publishUsage(h.eventBus, 'a', 'other-run', 500);
    expect(h.manager.snapshot('a')?.metrics.tokenSource).toBe('heuristic');

    // 收尾（settled）后迟到的 usage 不再生效：先收尾再发迟到事件。
    publishFinished(h.eventBus, 'a', 'r1');
    publishUsage(h.eventBus, 'a', 'r1', 700);
    expect(h.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 1, tokenSource: 'heuristic'}),
    );
  });

  it('注入降级：工厂返回 null 与「只建其一成功」都整条回退启发式（G-2）', () => {
    // 场景一：工厂恒返回 null（编码不可用，不抛错）→ 整条回退启发式。
    const nullFactory = createHarness({tokenEstimatorFactory: () => null});
    startRunningRun(nullFactory, 'a', 'r1');
    // ceil(13/3.35) = 4
    publishTextDelta(nullFactory.eventBus, 'a', 'r1', 'step one body');
    expect(nullFactory.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 4, tokenSource: 'heuristic'}),
    );
    publishThinkingDelta(nullFactory.eventBus, 'a', 'r1', '一二三四五');
    // 累计 18 字符 → ceil(18/3.35) = 6
    expect(nullFactory.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 6, tokenSource: 'heuristic'}),
    );
    nullFactory.manager.dispose();

    // 场景二：只建其一成功（第一条计数器建成、第二条返回 null）——代码刻意
    // 「两条都建成才启用」，半套状态会让正文/思考的增量口径不一致，整体回退。
    let calls = 0;
    const halfBuilt = createHarness({
      tokenEstimatorFactory: () => {
        calls += 1;
        if (calls === 1) {
          let text = '';
          return {
            push(delta: string) {
              text += delta;
            },
            get tokens() {
              return text.length;
            },
            get unencodableChars() {
              return 0;
            },
            reset() {
              text = '';
            },
          };
        }
        return null;
      },
    });
    startRunningRun(halfBuilt, 'a', 'r1');
    expect(calls).toBe(2);
    publishTextDelta(halfBuilt.eventBus, 'a', 'r1', 'step one body');
    // 半套未生效：读值是启发式 4（若误启用会是 1 字符 = 1 token 的 13）。
    expect(halfBuilt.manager.snapshot('a')?.metrics).toEqual(
      expect.objectContaining({completionTokens: 4, tokenSource: 'heuristic'}),
    );
    halfBuilt.manager.dispose();
  });

  it('注入跨 run：同会话二次 start 首读为 0，不带上一 run 的估算（G-2）', () => {
    const created: number[] = [];
    const h = createHarness({
      tokenEstimatorFactory: () => {
        created.push(created.length);
        let text = '';
        return {
          push(delta: string) {
            text += delta;
          },
          get tokens() {
            return text.length;
          },
          get unencodableChars() {
            return 0;
          },
          reset() {
            text = '';
          },
        };
      },
    });
    startRunningRun(h, 'a', 'r1');
    // 首个 run 累计 8 t（1 字符 = 1 token 的假估算器，启发式只会给 3）。
    publishTextDelta(h.eventBus, 'a', 'r1', 'abcdefgh');
    expect(h.manager.snapshot('a')?.metrics.completionTokens).toBe(8);
    expect(created).toHaveLength(2);

    // 收尾后同会话再发起：读数从零起算，不串入上一 run 的 8 t。
    publishFinished(h.eventBus, 'a', 'r1');
    advanceStreamTimers();
    h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
    expect(h.manager.startRun('a', 'p', 'again').ok).toBe(true);
    publishStarted(h.eventBus, 'a', 'r2');
    // 两条估算器随新单元重新构造（工厂再被调用两次）。
    expect(created).toHaveLength(4);
    expect(h.manager.snapshot('a')?.metrics).toEqual({
      textChars: 0,
      thinkingChars: 0,
      completionTokens: 0,
      tokenSource: 'heuristic',
    });
    // 新 run 的首个 delta 从 0 起算（不带上一 run 的 8）。
    publishTextDelta(h.eventBus, 'a', 'r2', 'ab');
    expect(h.manager.snapshot('a')?.metrics.completionTokens).toBe(2);

    h.manager.dispose();
  });

  it('注入真计数器且 encode 对特殊段抛错：投影 completionTokens 单调不减（B-1 端到端）', () => {
    // 注入 core 真计数器（非手写假实现），encode 对含 "§" 的段抛错——对应
    // 真机上 js-tiktoken 遇特殊 token 文本（disallowedSpecial="all"）。推入
    // 足够长的段落让该段跨过固化阈值进入固化路径。
    const h = createHarness({
      tokenEstimatorFactory: () =>
        createIncrementalTokenCounter({
          encode: text => {
            if (text.includes('§')) {
              throw new Error('special token text');
            }
            return text.length;
          },
        }),
    });
    startRunningRun(h, 'a', 'r1');

    const segments = ['a'.repeat(100), `§${'b'.repeat(120)}`, 'c'.repeat(50)];
    let previous = 0;
    for (const segment of segments) {
      publishTextDelta(h.eventBus, 'a', 'r1', segment);
      const current = h.manager.snapshot('a')!.metrics.completionTokens;
      // 固化段 encode 失败按 1:1 兜底计入：读值不得因「固化部分没加、尾窗又
      // 短了」而倒退（旧实现会在这里掉下去）。
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
    // 末值 = 累计字符数（1 字符 = 1 token，失败段 1:1 兜底 → 一段不缺）。
    expect(previous).toBe(
      segments.reduce((sum, segment) => sum + segment.length, 0),
    );

    // usage 真值到达后增量继续叠加（不冻结、不倒退）。
    publishUsage(h.eventBus, 'a', 'r1', 5000);
    expect(h.manager.snapshot('a')!.metrics.completionTokens).toBe(5000);
    publishTextDelta(h.eventBus, 'a', 'r1', 'd');
    expect(h.manager.snapshot('a')!.metrics.completionTokens).toBe(5001);

    h.manager.dispose();
  });

  it('C-1: 构造时不同步建估算器——水合单元零次，真实 run 在 begin() 建两次', () => {
    // 首建 tiktoken 编码表 180–420ms。放在构造函数里的话，「启动水合 / 子
    // 会话懒建」这类**根本不会发起 run** 的路径也要白付一次启动卡顿。
    const factory = jest.fn(() => createIncrementalTokenCounter({
      encode: text => text.length,
    }));
    const h = createHarness({tokenEstimatorFactory: factory});

    // 水合路径：adoptInterruptedUnit（内部 settleAsInterrupted）→
    // hydrateFromRunState，全程不经 begin()。
    const hydrated = h.manager.adoptInterruptedUnit('hydrated', 'p');
    expect(
      hydrated.hydrateFromRunState({
        runId: 'r-hydrated',
        startedAtMs: 0,
        settledAtMs: 1,
        metrics: {
          textChars: 12,
          thinkingChars: 0,
          completionTokens: 4_321,
          tokenSource: 'usage',
        },
        partialText: 'twelve chars.',
        partialThinking: '',
        pendingChildren: [],
      }),
    ).toBe(true);
    // 水合读值照旧（防御性重锚等价于 `读值 − ceil(chars/3.35)`）。
    expect(h.manager.snapshot('hydrated')?.metrics.completionTokens).toBe(4_321);
    expect(factory).not.toHaveBeenCalled();

    // 真实 run：startRun → new + begin()，begin() 内建两条（text+thinking）。
    // 不能在水合单元上调 begin() 凑这条断言：它的守卫是
    // `status !== 'idle'`，水合单元是 interrupted、调了直接返回 false。
    startRunningRun(h, 'running', 'r1');
    expect(factory).toHaveBeenCalledTimes(2);
    // 建完即归零，首个 delta 从 0 起算。
    publishTextDelta(h.eventBus, 'running', 'r1', 'ab');
    expect(h.manager.snapshot('running')?.metrics.completionTokens).toBe(2);

    h.manager.dispose();
  });
});
