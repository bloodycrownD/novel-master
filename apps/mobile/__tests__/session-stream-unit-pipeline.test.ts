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
  EVENT_SUBAGENT_CHILD_SESSION_CREATED,
  SimpleEventBus,
} from '@novel-master/core/events';
import {
  isMobileAgentActive,
  setMobileAgentActive,
} from '@/runtime/agent-activity';
import {SessionStreamUnitManager} from '@/services/session-stream-unit-manager.service';
import {
  SESSION_STREAM_APPLY_INTERVAL_MS,
  SESSION_STREAM_INGRESS_COALESCE_MS,
} from '@/services/session-stream-unit';
import type {SessionStreamWebviewHandle} from '@/services/session-stream-unit';
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

function createHarness(options?: {readonly settledGraceMs?: number}) {
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
    expect(snap?.metrics).toEqual({textChars: 11, thinkingChars: 3});
    expect(snap?.startedAtMs).toBe(CLOCK_START_MS);

    // step 边界：partial 清零（core registry 重置对齐），指标是 run 级累计不清
    publishStepCommitted(h.eventBus, 'a', 'r1');
    const afterStep = h.manager.snapshot('a');
    expect(afterStep?.partialText).toBe('');
    expect(afterStep?.partialThinking).toBe('');
    expect(afterStep?.metrics).toEqual({textChars: 11, thinkingChars: 3});

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
    expect(starting?.metrics).toEqual({textChars: 0, thinkingChars: 0});
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
    expect(after?.metrics).toEqual({textChars: 3, thinkingChars: 0});
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
    expect(settled?.metrics).toEqual({textChars: 3, thinkingChars: 0});
    expect(settled?.partialText).toBe('abc'); // settle 冲刷落地

    // 收尾后同 runId 的迟到 delta：状态守卫拒绝，指标不再增长
    publishTextDelta(h.eventBus, 'a', 'r1', 'late');
    advanceStreamTimers();
    const frozen = h.manager.snapshot('a');
    expect(frozen?.metrics).toEqual({textChars: 3, thinkingChars: 0});
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
    expect(snapA?.metrics).toEqual({textChars: 3, thinkingChars: 2});
    expect(snapB?.metrics).toEqual({textChars: 2, thinkingChars: 0});
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
    expect(snapA?.metrics).toEqual({textChars: 5, thinkingChars: 2});
    expect(snapB?.metrics).toEqual({textChars: 4, thinkingChars: 0});
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
