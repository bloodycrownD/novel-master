/**
 * 冻结末值速率（「上次生成 … · N t/s」）测试。
 *
 * 覆盖：
 * - 活跃期实时速率可读（delta 累积下 > 0），暂停期随时刻自然衰减；
 * - 收尾冻结：settle 取末值（窗口以最后样本时刻收尾）、随 settled 投影
 *   常驻，单元宽限销毁后仍可读且**不随时刻衰减**；
 * - session KKV 落库：settle 写 `stream_metrics/finalRate`（值可解析）；
 * - 跨重启：新 manager + 同 KKV 数据水合 settled 行后，投影带回速率；
 * - 极简 runtime（无 sessionKkv）：退化为内存冻结值，不抛错。
 *
 * @module test/session-stream-unit-final-rate
 */
import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import {
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  SimpleEventBus,
} from '@novel-master/core/events';
import {parseStreamFinalRateSnapshot} from '@novel-master/core/format';
import {
  SESSION_KKV_DOMAIN_STREAM_METRICS,
  STREAM_METRICS_FINAL_RATE_KEY,
} from '@novel-master/core/session-kkv';
import type {SessionRunState} from '@novel-master/core/session-run-state';
import {
  isMobileAgentActive,
  setMobileAgentActive,
} from '@/runtime/agent-activity';
import {buildChatStreamMetricsLine} from '@/hooks/useAgentStreamMetrics';
import {
  SessionStreamUnitManager,
  type SessionStreamRunStateStore,
} from '@/services/session-stream-unit-manager.service';

const TEST_SETTLED_GRACE_MS = 5_000;

/** 内存版 run 状态服务（真实 upsert/settle/listByStatuses 语义）。 */
function createFakeRunStateStore() {
  const rows = new Map<string, SessionRunState>();
  const store: SessionStreamRunStateStore = {
    async upsert(state) {
      rows.set(state.sessionId, {...state});
    },
    async settle(input) {
      rows.set(input.sessionId, {
        sessionId: input.sessionId,
        projectId: input.projectId,
        runId: input.runId,
        status: 'settled',
        startedAtMs: input.startedAtMs,
        textChars: input.textChars,
        thinkingChars: input.thinkingChars,
        completionTokens: input.completionTokens,
        tokenSource: input.tokenSource,
        partialText: null,
        partialThinking: null,
        pendingChildrenJson: null,
        updatedAtMs: input.updatedAtMs,
      });
    },
    async listByStatuses(statuses) {
      return [...rows.values()]
        .filter(row => (statuses as readonly string[]).includes(row.status))
        .map(row => ({...row}));
    },
  };
  return store;
}

/** 内存版 session KKV（同步落 Map，供落库/回读断言）。 */
function createFakeSessionKkv() {
  const values = new Map<string, string>();
  const cacheKey = (sessionId: string, domain: string, key: string) =>
    `${sessionId}|${domain}|${key}`;
  return {
    values,
    read: (sessionId: string) =>
      values.get(cacheKey(sessionId, SESSION_KKV_DOMAIN_STREAM_METRICS, STREAM_METRICS_FINAL_RATE_KEY)),
    service: {
      async get(sessionId: string, domain: string, key: string) {
        return values.get(cacheKey(sessionId, domain, key)) ?? null;
      },
      async set(sessionId: string, domain: string, key: string, value: string) {
        values.set(cacheKey(sessionId, domain, key), value);
      },
      async delete(sessionId: string, domain: string, key: string) {
        values.delete(cacheKey(sessionId, domain, key));
      },
      async clearDomain() {},
      async clearSession() {},
      async listKeys() {
        return [];
      },
    },
  };
}

function buildHarness(options?: {
  runStateStore?: SessionStreamRunStateStore;
  sessionKkv?: ReturnType<typeof createFakeSessionKkv>['service'];
}) {
  const eventBus = new SimpleEventBus();
  const runAgentTurn = jest.fn(
    async (_runtime: unknown, _scope: unknown, _content: string) => undefined,
  );
  const manager = new SessionStreamUnitManager({
    runtime: {
      eventBus,
      abortRegistry: {has: () => false, abort: jest.fn()},
      sessions: {get: async (sessionId: string) => ({id: sessionId, title: '会话'})},
      projects: {get: async (projectId: string) => ({id: projectId, name: '项目'})},
      messages: {
        listBySessionTail: jest.fn(async () => []),
        listBySessionPage: jest.fn(async () => []),
      },
      ...(options?.sessionKkv == null
        ? {}
        : {sessionKkv: options.sessionKkv}),
    } as never,
    runAgentTurn: runAgentTurn as never,
    settledGraceMs: TEST_SETTLED_GRACE_MS,
    runStateService: options?.runStateStore,
    yieldQuantum: async () => undefined,
  });
  // 无持久层：水合手动标记完成（settled 投影读口受 hydrated 门禁约束）；
  // 有持久层：交给构造 kick 的 hydrate（跨重启用例显式 await）。
  if (options?.runStateStore == null) {
    manager.markHydrated();
  }
  return {eventBus, manager};
}

/** 跑一轮带流量的 run（每 250ms 一个 50 字符 delta）。 */
function driveRun(
  eventBus: SimpleEventBus,
  manager: SessionStreamUnitManager,
  deltaCount = 8,
): void {
  manager.startRun('s1', 'p1', 'hi');
  eventBus.publish(EVENT_AGENT_RUN_STARTED, {
    sessionId: 's1',
    projectId: 'p1',
    runId: 'r1',
  });
  for (let i = 0; i < deltaCount; i += 1) {
    eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
      sessionId: 's1',
      runId: 'r1',
      text: 'x'.repeat(50),
    });
    jest.advanceTimersByTime(250);
  }
}

function finishRun(eventBus: SimpleEventBus): void {
  eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
    sessionId: 's1',
    projectId: 'p1',
    runId: 'r1',
    stopReason: 'end_turn',
  } as never);
}

describe('冻结末值速率（stream-metrics-tokens-final-rate）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setMobileAgentActive(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    setMobileAgentActive(false);
  });

  it('活跃期实时速率可读，暂停期随时刻衰减', () => {
    const h = buildHarness();
    driveRun(h.eventBus, h.manager);

    const live = h.manager.rateTokensPerSecond('s1', Date.now());
    expect(live).not.toBeNull();
    expect(live! > 0).toBe(true);

    // 不再有 delta、只推进时刻：分子不变分母增大 → 衰减。
    jest.advanceTimersByTime(3_000);
    const decayed = h.manager.rateTokensPerSecond('s1', Date.now());
    expect(decayed).not.toBeNull();
    expect(decayed! < live!).toBe(true);

    h.manager.dispose();
  });

  it('收尾冻结末值：随 settled 投影常驻，单元销毁后不随时间衰减', () => {
    const h = buildHarness();
    driveRun(h.eventBus, h.manager);
    // 收尾前再停 3s：冻结值应取「最后一段在有输出时」的速度，不被停顿拉低。
    jest.advanceTimersByTime(3_000);
    const liveBeforeSettle = h.manager.rateTokensPerSecond('s1', Date.now());

    finishRun(h.eventBus);
    const projection = h.manager.getSettledProjection('s1');
    expect(projection).not.toBeNull();
    const frozen = projection!.rateTokensPerSecond;
    expect(frozen).not.toBeNull();
    expect(frozen! > 0).toBe(true);
    // 冻结值 = 末值快照，不低于（被停顿拖低的）实时读数。
    expect(frozen! >= liveBeforeSettle!).toBe(true);

    // 宽限销毁：单元出表，读数走 settled 投影——冻结值不随时刻变化。
    jest.advanceTimersByTime(TEST_SETTLED_GRACE_MS + 1_000);
    expect(h.manager.snapshot('s1')).toBe(null);
    expect(h.manager.rateTokensPerSecond('s1', Date.now())).toBe(frozen);
    expect(h.manager.rateTokensPerSecond('s1', Date.now() + 600_000)).toBe(
      frozen,
    );

    h.manager.dispose();
  });

  it('settle 把末值速率写入 session KKV（stream_metrics/finalRate，值可解析）', () => {
    const kkv = createFakeSessionKkv();
    const h = buildHarness({sessionKkv: kkv.service});
    driveRun(h.eventBus, h.manager);
    finishRun(h.eventBus);

    const raw = kkv.read('s1');
    const parsed = parseStreamFinalRateSnapshot(raw ?? null);
    const projection = h.manager.getSettledProjection('s1');
    expect(parsed).not.toBeNull();
    expect(parsed!.rate).toBe(projection!.rateTokensPerSecond);
    // 自检字段：采样当时的累计 token 与时刻都带上了。
    expect(parsed!.tokens).toBe(projection!.metrics.completionTokens);
    expect(parsed!.atMs > 0).toBe(true);

    h.manager.dispose();
  });

  it('跨重启水合：新 manager 从 session KKV 读回冻结速率到 settled 投影', async () => {
    const kkv = createFakeSessionKkv();
    const store = createFakeRunStateStore();
    const first = buildHarness({runStateStore: store, sessionKkv: kkv.service});
    // 有持久层时投影读口受水合门禁约束：先等首次水合完成再跑本轮 run。
    await first.manager.hydrate();
    driveRun(first.eventBus, first.manager);
    finishRun(first.eventBus);
    const frozen = first.manager.getSettledProjection('s1')!.rateTokensPerSecond;
    first.manager.dispose();
    expect(frozen).not.toBeNull();

    // 「重启」：新 manager 实例 + 同 run_state 行 + 同 session KKV 数据。
    const second = buildHarness({runStateStore: store, sessionKkv: kkv.service});
    await second.manager.hydrate();
    const projection = second.manager.getSettledProjection('s1');
    expect(projection).not.toBeNull();
    expect(projection!.rateTokensPerSecond).toBe(frozen);
    expect(second.manager.rateTokensPerSecond('s1', Date.now())).toBe(frozen);

    second.manager.dispose();
  });

  it('极简 runtime（无 sessionKkv）：冻结值仍走内存投影，不抛错', () => {
    const h = buildHarness();
    driveRun(h.eventBus, h.manager);
    finishRun(h.eventBus);
    jest.advanceTimersByTime(TEST_SETTLED_GRACE_MS + 1_000);

    const projection = h.manager.getSettledProjection('s1');
    expect(projection).not.toBeNull();
    expect(projection!.rateTokensPerSecond).not.toBeNull();

    h.manager.dispose();
  });

  it('子会话（消费型 run）：也产出 settled 投影与冻结速率，且不写持久层/KKV', async () => {
    const kkv = createFakeSessionKkv();
    const store = createFakeRunStateStore();
    const settleCalls: string[] = [];
    const spyStore: SessionStreamRunStateStore = {
      ...store,
      async settle(input) {
        settleCalls.push(input.sessionId);
        return store.settle(input);
      },
    };
    const h = buildHarness({runStateStore: spyStore, sessionKkv: kkv.service});
    // 有持久层时投影读口受水合门禁约束：先等首次水合完成。
    await h.manager.hydrate();
    // 子会话 run：不经 manager.startRun 发起，事件到达时 lazy 建消费型单元。
    const childId = 'child-1';
    h.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: childId,
      projectId: 'p1',
      runId: 'rc',
    });
    for (let i = 0; i < 6; i += 1) {
      h.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
        sessionId: childId,
        runId: 'rc',
        text: 'x'.repeat(50),
      });
      jest.advanceTimersByTime(250);
    }
    h.eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
      sessionId: childId,
      projectId: 'p1',
      runId: 'rc',
      stopReason: 'end_turn',
    } as never);

    // 收尾即产出投影（含冻结速率）；此后推进时间不衰减，且速率读口可用——
    // 单元被 LRU 淘汰后由投影兜底（子会话屏「上次生成」不断源）。
    const atSettle = h.manager.getSettledProjection(childId);
    expect(atSettle).not.toBeNull();
    expect(atSettle!.metrics.completionTokens).toBe(90); // ceil(300/3.35)
    const frozenRate = atSettle!.rateTokensPerSecond;
    expect(frozenRate).not.toBeNull();
    jest.advanceTimersByTime(TEST_SETTLED_GRACE_MS + 1_000);
    expect(h.manager.getSettledProjection(childId)!.rateTokensPerSecond).toBe(
      frozenRate,
    );
    expect(h.manager.rateTokensPerSecond(childId, Date.now())).toBe(frozenRate);

    // 消费型 run 不写持久层、不落 KKV（无跨重启读回路径，避免留无人读的行）。
    expect(settleCalls).not.toContain(childId);
    expect(kkv.read(childId)).toBeUndefined();

    h.manager.dispose();
  });

  it('零输出 run 收尾删掉上一轮 KKV 速率：水合不再拼出凭空造数的 t/s（B-1）', async () => {
    const kkv = createFakeSessionKkv();
    const store = createFakeRunStateStore();
    const first = buildHarness({runStateStore: store, sessionKkv: kkv.service});
    await first.manager.hydrate();
    // 第一轮：有流量的 run 把末值速率落进 KKV。
    driveRun(first.eventBus, first.manager);
    finishRun(first.eventBus);
    expect(kkv.read('s1')).not.toBeUndefined();
    expect(
      first.manager.getSettledProjection('s1')!.rateTokensPerSecond,
    ).not.toBeNull();

    // 第二轮：同会话零输出 run（无 delta → 采样器无样本），事件路径收尾。
    first.manager.startRun('s1', 'p1', '再来一次');
    first.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'r2',
    });
    first.eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'r2',
      stopReason: 'end_turn',
    } as never);

    // 本轮无速率：KKV 键必须已删（留着就是上一轮的陈旧值）。
    expect(kkv.read('s1')).toBeUndefined();
    expect(first.manager.getSettledProjection('s1')!.rateTokensPerSecond).toBe(
      null,
    );
    first.manager.dispose();

    // 「重启」：新 manager + 同一份 run_state 行与 KKV 数据水合。
    const restarted = buildHarness({
      runStateStore: store,
      sessionKkv: kkv.service,
    });
    await restarted.manager.hydrate();
    const hydrated = restarted.manager.getSettledProjection('s1');
    expect(hydrated).not.toBeNull();
    expect(hydrated!.rateTokensPerSecond).toBeNull();
    // 文案省略速率段（缺值即省略，不把上一轮的速度拼到本轮「上次生成」上）。
    expect(hydrated!.metrics.completionTokens).toBe(0);
    expect(
      buildChatStreamMetricsLine({
        running: false,
        elapsedMs: hydrated!.elapsedMs,
        completionTokens: hydrated!.metrics.completionTokens,
        tokenSource: hydrated!.metrics.tokenSource,
        tokensPerSecond: hydrated!.rateTokensPerSecond,
      }),
    ).not.toContain('t/s');
    restarted.manager.dispose();
  });

  it('消费型单元宽限到期出表：snapshot 归 null、投影仍在、refcount 不变（C-1）', () => {
    const h = buildHarness();
    const childId = 'child-1';
    h.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: childId,
      projectId: 'p1',
      runId: 'rc',
    });
    for (let i = 0; i < 6; i += 1) {
      h.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
        sessionId: childId,
        runId: 'rc',
        text: 'x'.repeat(50),
      });
      jest.advanceTimersByTime(250);
    }
    h.eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
      sessionId: childId,
      projectId: 'p1',
      runId: 'rc',
      stopReason: 'end_turn',
    } as never);

    // 宽限窗口内：单元仍在表（终态投影平滑落点）。
    expect(h.manager.snapshot(childId)).not.toBeNull();
    expect(isMobileAgentActive()).toBe(false); // 消费型 run 不占 refcount

    // 宽限到期：单元按 onGraceExpired 出表（此前无回调会永久残留）。
    jest.advanceTimersByTime(TEST_SETTLED_GRACE_MS + 1);
    expect(h.manager.snapshot(childId)).toBe(null);
    // settled 投影仍在（子会话「上次生成」不断源）；refcount 不受摘除影响。
    const projection = h.manager.getSettledProjection(childId);
    expect(projection).not.toBeNull();
    expect(h.manager.rateTokensPerSecond(childId, Date.now())).toBe(
      projection!.rateTokensPerSecond,
    );
    expect(isMobileAgentActive()).toBe(false);

    h.manager.dispose();
  });
});
