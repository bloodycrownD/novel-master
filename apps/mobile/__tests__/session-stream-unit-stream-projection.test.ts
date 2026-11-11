/**
 * 流式投影单元测试（chat-streaming-projection Step 2：C4/C5）。
 *
 * 覆盖：
 * - T-SP15：assistant STEP_COMMITTED 冻结旧记录（文本保留）、开新 streamId、
 *   不发 reset-stream；tool_results 不轮转；同毫秒建两个 unit 的 ordinal 0
 *   id 不同（进程级 unitEpoch）；
 * - T-SP16：tool-use 订阅——tools 追加 pending/按 toolUseId 去重/错 runId
 *   忽略；生效即推 tools-only 的 stream-batch（带当前 streamId）；
 * - T-SP17：DB 接管——reload 后新增 assistant 一一配对、多余行不配对、
 *   streamRowIds 有界且随单元替换迁移；
 * - T-SP32：snapshot 的 streamRows/streamRowIds 引用稳定（内容变化才换）。
 */
import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import {
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
  SimpleEventBus,
} from '@novel-master/core/events';
import {
  isMobileAgentActive,
  setMobileAgentActive,
} from '@/runtime/agent-activity';
import {addLogSink} from '@novel-master/core/log';
import {SessionStreamUnitManager} from '@/services/session-stream-unit-manager.service';
import {SessionStreamUnit} from '@/services/session-stream-unit';
import type {SessionStreamWebviewHandle} from '@/services/session-stream-unit';
import {resetKeepAliveStateForTests} from '@/services/agent-finished-notification';
import type {ChatMessageData} from '@novel-master/core/chat';

const CLOCK_START_MS = 2_000_000;

/** 与单元实现同值的 ingress 合并窗口（32ms）。 */
const SESSION_STREAM_INGRESS_COALESCE_MS = 32;

/** 与单元实现同值的 apply 节拍（64ms）。 */
const SESSION_STREAM_APPLY_INTERVAL_MS = 64;

function advanceStreamTimers(extraMs = 10): void {
  jest.advanceTimersByTime(
    SESSION_STREAM_INGRESS_COALESCE_MS +
      SESSION_STREAM_APPLY_INTERVAL_MS +
      extraMs,
  );
}

async function flushAsync(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

function makeAssistant(sid: string, seq: number): ChatMessageData {
  return {
    id: `${sid}-db-${seq}`,
    sessionId: sid,
    seq,
    role: 'assistant',
    content: `assistant-${seq}`,
    createdAtMs: seq * 1000,
  } as unknown as ChatMessageData;
}

function makeMessageStore(db: Map<string, ChatMessageData[]>) {
  return {
    listBySessionTail: jest.fn(
      async (sid: string, options: {limit: number}) => {
        const rows = [...(db.get(sid) ?? [])].sort((a, b) => a.seq - b.seq);
        return rows.slice(-options.limit);
      },
    ),
    listBySessionPage: jest.fn(async () => []),
  };
}

function createHarness(options?: {readonly settledGraceMs?: number}) {
  const eventBus = new SimpleEventBus();
  const db = new Map<string, ChatMessageData[]>();
  const messages = makeMessageStore(db);
  const manager = new SessionStreamUnitManager({
    runtime: {
      eventBus,
      abortRegistry: {
        has: () => false,
        abort: jest.fn(),
        register: jest.fn(),
        unregister: jest.fn(),
      },
      sessions: {get: async (sessionId: string) => ({id: sessionId})},
      projects: {get: async (projectId: string) => ({id: projectId})},
      messages,
    } as never,
    runAgentTurn: (() => new Promise(() => undefined)) as never,
    settledGraceMs: options?.settledGraceMs,
    yieldQuantum: async () => undefined,
  });
  manager.markHydrated();
  return {eventBus, db, messages, manager};
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

function publishText(
  eventBus: SimpleEventBus,
  sessionId: string,
  runId: string,
  text: string,
): void {
  eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {sessionId, runId, text});
}

function publishStep(
  eventBus: SimpleEventBus,
  sessionId: string,
  runId: string,
  phase: 'assistant' | 'tool_results' = 'assistant',
  messageId?: string,
): void {
  eventBus.publish(EVENT_AGENT_STEP_COMMITTED, {
    sessionId,
    projectId: 'p',
    runId,
    phase,
    ...(messageId != null ? {messageId} : {}),
  });
}

function makeUser(sid: string, seq: number): ChatMessageData {
  return {
    id: `${sid}-db-${seq}`,
    sessionId: sid,
    seq,
    role: 'user',
    content: `user-${seq}`,
    createdAtMs: seq * 1000,
  } as unknown as ChatMessageData;
}

function publishToolUse(
  eventBus: SimpleEventBus,
  sessionId: string,
  runId: string,
  id: string,
  name = 'read',
): void {
  eventBus.publish(EVENT_AGENT_STREAM_TOOL_USE, {
    sessionId,
    runId,
    id,
    name,
    input: {path: 'a.md'},
  });
}

function startRun(
  h: ReturnType<typeof createHarness>,
  sessionId: string,
  runId: string,
): void {
  expect(h.manager.startRun(sessionId, 'p', 'hi').ok).toBe(true);
  publishStarted(h.eventBus, sessionId, runId);
}

function recordingHandle(handleId: string): {
  readonly handle: SessionStreamWebviewHandle;
  readonly payloads: unknown[];
  readonly controls: unknown[];
} {
  const payloads: unknown[] = [];
  const controls: unknown[] = [];
  return {
    handle: {
      handleId,
      onStreamPayload: payload => payloads.push(payload),
      onControlMessage: message => controls.push(message),
    },
    payloads,
    controls,
  };
}

describe('SessionStreamUnit 流式 step 记录（T-SP15）', () => {
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

  it('assistant STEP_COMMITTED 冻结旧记录（文本保留）并开新 streamId，不发 reset-stream', () => {
    const unit = new SessionStreamUnit({sessionId: 'a', projectId: 'p'});
    unit.begin();
    unit.markRunning('r1');
    const firstId = unit.snapshot().streamRows[0]?.streamId;
    const recorder = recordingHandle('w');
    unit.attachWebview(recorder.handle);
    unit.ingestTextDelta('r1', 'step1-body');

    expect(unit.handleStepCommitted('r1', 'assistant')).toBe(true);
    const rows = unit.snapshot().streamRows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      streamId: firstId,
      status: 'finished',
      text: 'step1-body',
      messageId: null,
    });
    expect(rows[1]).toMatchObject({status: 'streaming', text: ''});
    expect(rows[1]?.streamId).not.toBe(firstId);
    // 步边界不再广播清尾（reset-stream 只留给消息操作）
    expect(recorder.controls).toEqual([]);
    unit.destroy();
  });

  it('tool_results STEP_COMMITTED 不轮转 stream（不凭空多一条 assistant 行）', () => {
    const unit = new SessionStreamUnit({sessionId: 'a', projectId: 'p'});
    unit.begin();
    unit.markRunning('r1');
    unit.ingestTextDelta('r1', 'tool step');

    expect(unit.handleStepCommitted('r1', 'tool_results')).toBe(true);
    const rows = unit.snapshot().streamRows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({status: 'streaming', text: ''});
    expect(unit.snapshot().partialText).toBe('');
    unit.destroy();
  });

  it('同毫秒建两个 unit：ordinal 0 的 streamId 不同（unitEpoch 而非 startedAtMs）', () => {
    const first = new SessionStreamUnit({sessionId: 'same', projectId: 'p'});
    const second = new SessionStreamUnit({sessionId: 'same', projectId: 'p'});
    first.begin();
    second.begin();
    const firstId = first.snapshot().streamRows[0]?.streamId;
    const secondId = second.snapshot().streamRows[0]?.streamId;
    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    expect(firstId).not.toBe(secondId);
    expect(firstId).toContain('st:same:');
    expect(secondId).toContain('st:same:');
    first.destroy();
    second.destroy();
  });
});

describe('tool-use 订阅与 tools-only stream-batch（T-SP16）', () => {
  let h: ReturnType<typeof createHarness>;

  beforeEach(() => {
    setMobileAgentActive(false);
    jest.clearAllMocks();
    resetKeepAliveStateForTests();
    jest.useFakeTimers();
    jest.setSystemTime(CLOCK_START_MS);
    h = createHarness();
  });

  afterEach(() => {
    h.manager.dispose();
    jest.useRealTimers();
    setMobileAgentActive(false);
    resetKeepAliveStateForTests();
  });

  it('生效即推 tools-only batch（带当前 streamId）；按 toolUseId 去重', () => {
    startRun(h, 's', 'r1');
    const streamId = h.manager.snapshot('s')?.streamRows[0]?.streamId;
    const recorder = recordingHandle('w');
    h.manager.attachWebview('s', recorder.handle);
    expect(recorder.payloads).toEqual([]);

    publishToolUse(h.eventBus, 's', 'r1', 'tool-1');
    expect(recorder.payloads).toEqual([
      {
        type: 'stream-batch',
        streamId,
        segments: [],
        tools: [
          {
            toolUseId: 'tool-1',
            name: 'read',
            input: {path: 'a.md'},
            status: 'pending',
          },
        ],
      },
    ]);
    expect(h.manager.snapshot('s')?.streamRows.at(-1)?.tools).toHaveLength(1);

    // 重复 toolUseId：不重复追加、不再推
    publishToolUse(h.eventBus, 's', 'r1', 'tool-1');
    expect(recorder.payloads).toHaveLength(1);
    expect(h.manager.snapshot('s')?.streamRows.at(-1)?.tools).toHaveLength(1);
  });

  it('非 running（starting）与错 runId 的 tool-use 忽略', () => {
    h.manager.startRun('s', 'p', 'hi');
    // starting：runId 未回填
    publishToolUse(h.eventBus, 's', 'r1', 'tool-early');
    expect(h.manager.snapshot('s')?.streamRows.at(-1)?.tools).toEqual([]);

    publishStarted(h.eventBus, 's', 'r1');
    publishToolUse(h.eventBus, 's', 'r-other', 'tool-stale');
    expect(h.manager.snapshot('s')?.streamRows.at(-1)?.tools).toEqual([]);
  });
});

describe('DB 接管映射（T-SP17）', () => {
  let h: ReturnType<typeof createHarness>;

  beforeEach(() => {
    setMobileAgentActive(false);
    jest.clearAllMocks();
    resetKeepAliveStateForTests();
    jest.useFakeTimers();
    jest.setSystemTime(CLOCK_START_MS);
    h = createHarness();
  });

  afterEach(() => {
    h.manager.dispose();
    jest.useRealTimers();
    setMobileAgentActive(false);
    resetKeepAliveStateForTests();
  });

  it('reload 后新增 assistant 一一配对：messageId + streamRowIds，行身份仍是 streamId', async () => {
    startRun(h, 's', 'r1');
    const streamId = h.manager.snapshot('s')?.streamRows[0]?.streamId;
    publishText(h.eventBus, 's', 'r1', 'answer');
    advanceStreamTimers();

    // core 先落库，再发 STEP_COMMITTED；单元随后 force reload
    h.db.set('s', [makeAssistant('s', 1)]);
    publishStep(h.eventBus, 's', 'r1');
    await flushAsync();

    const snap = h.manager.snapshot('s');
    expect(snap?.streamRowIds.get('s-db-1')).toBe(streamId);
    // 已接管的 finished 记录不再出现在 streamRows（DB 行接管）
    expect(snap?.streamRows.some(row => row.streamId === streamId)).toBe(false);
  });

  it('STEP_COMMITTED 带 messageId：立即接管、不等 reload；历史 assistant 不被错配（P1-2）', async () => {
    const history = [makeAssistant('s', 1), makeAssistant('s', 2)];
    h.db.set('s', history);
    startRun(h, 's', 'r1');
    const streamId = h.manager.snapshot('s')?.streamRows[0]?.streamId;
    publishText(h.eventBus, 's', 'r1', 'answer');
    advanceStreamTimers();

    const current = makeAssistant('s', 3);
    h.db.set('s', [...history, current]);
    publishStep(h.eventBus, 's', 'r1', 'assistant', current.id);

    // 不依赖 reload：事件自带落库行 id，立即写映射（历史 assistant 不是候选）
    const immediate = h.manager.snapshot('s');
    expect(immediate?.streamRowIds.get(current.id)).toBe(streamId);
    expect(immediate?.streamRowIds.size).toBe(1);
    // 已接管记录不再出现在流式投影（DB 行 + 映射接管同一行身份）
    expect(immediate?.streamRows.some(row => row.streamId === streamId)).toBe(
      false,
    );

    await flushAsync();
    const after = h.manager.snapshot('s');
    expect(after?.streamRowIds.size).toBe(1);
    expect(after?.streamRowIds.get(current.id)).toBe(streamId);
    expect(after?.streamRows.some(row => row.streamId === streamId)).toBe(
      false,
    );
    expect(after?.messages.map(message => message.id)).toEqual([
      history[0]?.id,
      history[1]?.id,
      current.id,
    ]);
  });

  it('非 force 结果不消费待接管队列；force 用同一消息面落地时接管并通知（P1-2）', async () => {
    const row = makeAssistant('ns', 1);
    let releaseForce!: (rows: readonly ChatMessageData[]) => void;
    let call = 0;
    const store = {
      listBySessionTail: jest.fn(() => {
        call += 1;
        if (call === 1) {
          // step 边界自动 kick 的 force reload 卡住（模拟查询先于落库行可见）
          return new Promise<readonly ChatMessageData[]>(resolve => {
            releaseForce = rows => resolve(rows);
          });
        }
        return Promise.resolve<readonly ChatMessageData[]>([row]);
      }),
      listBySessionPage: jest.fn(async () => []),
    };
    const onProjectionChanged = jest.fn();
    const unit = new SessionStreamUnit({
      sessionId: 'ns',
      projectId: 'p',
      messageStore: store,
      onProjectionChanged,
    });
    unit.begin();
    unit.markRunning('r1');
    const streamId = unit.snapshot().streamRows[0]?.streamId;
    unit.ingestTextDelta('r1', 'answer');
    jest.advanceTimersByTime(
      SESSION_STREAM_INGRESS_COALESCE_MS + SESSION_STREAM_APPLY_INTERVAL_MS,
    );
    unit.handleStepCommitted('r1', 'assistant'); // 无 messageId → 待接管

    // 非 force 回源：拿到新增 assistant 也不配对（可能是插入前的旧面）
    await unit.loadTailMessages();
    expect(unit.getStreamRowIds().size).toBe(0);
    expect(unit.finishedStreamCount()).toBe(1);

    // force 落地同一消息面（引用未变）：adoption 写入必须通知宿主
    onProjectionChanged.mockClear();
    releaseForce([row]);
    await flushAsync();
    expect(unit.getStreamRowIds().get(row.id)).toBe(streamId);
    expect(onProjectionChanged).toHaveBeenCalled();
    // 接管成功后记录退出内存（P2-11）
    expect(unit.finishedStreamCount()).toBe(0);
    unit.destroy();
  });

  it('待接管记录配不到新增 assistant 时记 warn（spec §2.1.3 规则 5 / S1）', async () => {
    const warnings: string[] = [];
    const removeSink = addLogSink({
      write: record => {
        if (record.level === 'warn') {
          warnings.push(record.message);
        }
      },
    });
    try {
      const unit = new SessionStreamUnit({
        sessionId: 'warn-s',
        projectId: 'p',
        messageStore: {
          listBySessionTail: async () => [],
          listBySessionPage: async () => [],
        },
      });
      unit.begin();
      unit.markRunning('r1');
      unit.ingestTextDelta('r1', 'answer');
      jest.advanceTimersByTime(
        SESSION_STREAM_INGRESS_COALESCE_MS + SESSION_STREAM_APPLY_INTERVAL_MS,
      );
      unit.handleStepCommitted('r1', 'assistant'); // 无 messageId → 待接管

      await unit.loadTailMessages({force: true});
      expect(warnings).toContain('stream adoption unmatched');
      // 配不到时记录保持 messageId=null，继续以 streamId 呈现
      expect(
        unit
          .snapshot()
          .streamRows.some(
            row =>
              row.status === 'finished' &&
              row.text === 'answer' &&
              row.messageId == null,
          ),
      ).toBe(true);
      unit.destroy();
    } finally {
      removeSink();
    }
  });

  it('新增 assistant 多于 pending：多余行不配对，只有第一条进入映射', async () => {
    startRun(h, 's', 'r1');
    publishText(h.eventBus, 's', 'r1', 'partial answer');
    advanceStreamTimers();

    // 失败路径额外落一条 [生成失败] 行（两条新增，只有一条 pending）
    h.db.set('s', [makeAssistant('s', 1), makeAssistant('s', 2)]);
    publishStep(h.eventBus, 's', 'r1');
    await flushAsync();

    const ids = h.manager.snapshot('s')?.streamRowIds;
    expect(ids?.size).toBe(1);
    expect(ids?.has('s-db-1')).toBe(true);
    expect(ids?.has('s-db-2')).toBe(false);
  });

  it('streamRowIds 有界 200 且随单元替换迁移给新单元', async () => {
    startRun(h, 's', 'r1');
    const streamId = h.manager.snapshot('s')?.streamRows[0]?.streamId;
    publishText(h.eventBus, 's', 'r1', 'answer');
    advanceStreamTimers();
    h.db.set('s', [makeAssistant('s', 1)]);
    publishStep(h.eventBus, 's', 'r1');
    await flushAsync();
    publishFinished(h.eventBus, 's', 'r1');
    await flushAsync();

    const oldMap = h.manager.snapshot('s')?.streamRowIds;
    expect(oldMap?.get('s-db-1')).toBe(streamId);

    // 同会话再发起：settled 旧单元被替换吸收，映射继承
    startRun(h, 's', 'r2');
    expect(h.manager.snapshot('s')?.streamRowIds.get('s-db-1')).toBe(streamId);

    // 有界：直接继承一份超限映射，只保留最近 200 条
    const big = new Map<string, string>();
    for (let i = 0; i < 250; i += 1) {
      big.set(`bulk-${i}`, `stream-${i}`);
    }
    h.manager.snapshot('s'); // 确保单元已建
    const unit = new SessionStreamUnit({sessionId: 'bounded', projectId: 'p'});
    unit.inheritStreamRowIds(big);
    expect(unit.getStreamRowIds().size).toBe(200);
    expect(unit.getStreamRowIds().has('bulk-49')).toBe(false);
    expect(unit.getStreamRowIds().has('bulk-50')).toBe(true);
    expect(unit.getStreamRowIds().has('bulk-249')).toBe(true);
    unit.destroy();
  });
});

describe('snapshot 引用稳定（T-SP32）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(CLOCK_START_MS);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('内容未变时 streamRows/streamRowIds 返回同一引用；text/tools 变化才换新', () => {
    const unit = new SessionStreamUnit({sessionId: 'a', projectId: 'p'});
    unit.begin();
    unit.markRunning('r1');

    const first = unit.snapshot();
    const second = unit.snapshot();
    expect(second.streamRows).toBe(first.streamRows);
    expect(second.streamRowIds).toBe(first.streamRowIds);

    // metric/usage tick 不换流式行引用
    unit.ingestUsage('r1', 42);
    expect(unit.snapshot().streamRows).toBe(first.streamRows);

    unit.ingestTextDelta('r1', 'abc');
    jest.advanceTimersByTime(
      SESSION_STREAM_INGRESS_COALESCE_MS + SESSION_STREAM_APPLY_INTERVAL_MS,
    );
    const afterText = unit.snapshot();
    expect(afterText.streamRows).not.toBe(first.streamRows);
    expect(afterText.streamRows.at(-1)?.text).toBe('abc');

    // tools 变化换新引用（且带 streamId 的 tools-only batch 推送）
    const recorder = recordingHandle('w');
    unit.attachWebview(recorder.handle);
    unit.ingestToolUse('r1', {id: 't1', name: 'read', input: {}});
    const afterTools = unit.snapshot();
    expect(afterTools.streamRows).not.toBe(afterText.streamRows);
    expect(afterTools.streamRows.at(-1)?.tools).toHaveLength(1);
    unit.destroy();
  });
});

describe('interrupted 投影与 clearStreamProjection', () => {
  it('水合 partial 投影为唯一 finished 流式行；clear 后清空但保留 streamRowIds', () => {
    const unit = new SessionStreamUnit({sessionId: 's', projectId: 'p'});
    unit.settleAsInterrupted();
    expect(
      unit.hydrateFromRunState({
        runId: 'r1',
        startedAtMs: CLOCK_START_MS,
        settledAtMs: CLOCK_START_MS + 5_000,
        metrics: {
          textChars: 4,
          thinkingChars: 0,
          completionTokens: 1,
          tokenSource: 'heuristic',
        },
        partialText: '半截',
        partialThinking: '',
        pendingChildren: [],
      }),
    ).toBe(true);

    const rows = unit.snapshot().streamRows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      streamId: `st:s:interrupted:${CLOCK_START_MS + 5_000}`,
      status: 'finished',
      text: '半截',
      thinking: '',
      tools: [],
      messageId: null,
    });

    // 已接管映射不随投影清理丢失（P2-18f：标题声称保留，正文必须断言）
    unit.inheritStreamRowIds(new Map([['db-1', 'st:handover']]));
    const removed = unit.clearStreamProjection();
    expect(removed).toEqual([rows[0]?.streamId]);
    expect(unit.snapshot().streamRows).toEqual([]);
    expect(unit.snapshot().partialText).toBe('');
    expect(unit.getStreamRowIds().get('db-1')).toBe('st:handover');
    unit.destroy();
  });

  it('clearStreamProjection 只返回投影可见 id：已接管行不广播、映射保留（P1-4）', () => {
    jest.useFakeTimers();
    try {
      const unit = new SessionStreamUnit({sessionId: 's', projectId: 'p'});
      unit.begin();
      unit.markRunning('r1');
      unit.ingestTextDelta('r1', 'adopted-body');
      jest.advanceTimersByTime(
        SESSION_STREAM_INGRESS_COALESCE_MS + SESSION_STREAM_APPLY_INTERVAL_MS,
      );
      unit.handleStepCommitted('r1', 'assistant', 'db-1');
      const adoptedId = unit.getStreamRowIds().get('db-1');
      expect(adoptedId).toBeDefined();

      // 再冻结一条未接管的 finished（旧事件形态/失败路径）
      unit.ingestTextDelta('r1', 'pending-body');
      jest.advanceTimersByTime(
        SESSION_STREAM_INGRESS_COALESCE_MS + SESSION_STREAM_APPLY_INTERVAL_MS,
      );
      unit.handleStepCommitted('r1', 'assistant');

      const visible = unit.snapshot().streamRows;
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.some(row => row.streamId === adoptedId)).toBe(false);

      const removed = unit.clearStreamProjection();
      expect(removed).toEqual(visible.map(row => row.streamId));
      expect(removed).not.toContain(adoptedId);
      expect(unit.snapshot().streamRows).toEqual([]);
      // 已接管行由映射继续呈现，rollback/fork 不会删掉它再重建
      expect(unit.getStreamRowIds().get('db-1')).toBe(adoptedId);
      unit.destroy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('P2-11: 已接管记录不驻留 finishedStreams', () => {
  it('40 个 step 全部直接接管：finishedStreamCount 保持 0，映射齐全', () => {
    jest.useFakeTimers();
    try {
      const unit = new SessionStreamUnit({sessionId: 's', projectId: 'p'});
      unit.begin();
      unit.markRunning('r1');
      for (let i = 0; i < 40; i += 1) {
        unit.ingestTextDelta('r1', `step-${i}`);
        jest.advanceTimersByTime(
          SESSION_STREAM_INGRESS_COALESCE_MS + SESSION_STREAM_APPLY_INTERVAL_MS,
        );
        expect(unit.handleStepCommitted('r1', 'assistant', `db-${i}`)).toBe(
          true,
        );
      }
      expect(unit.finishedStreamCount()).toBe(0);
      expect(unit.getStreamRowIds().size).toBe(40);
      unit.destroy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('streamRowIds 生命周期（P1-3 / P2-18f）', () => {
  let h: ReturnType<typeof createHarness>;

  beforeEach(() => {
    setMobileAgentActive(false);
    jest.clearAllMocks();
    resetKeepAliveStateForTests();
    jest.useFakeTimers();
    jest.setSystemTime(CLOCK_START_MS);
    h = createHarness({settledGraceMs: 1000});
  });

  afterEach(() => {
    h.manager.dispose();
    jest.useRealTimers();
    setMobileAgentActive(false);
    resetKeepAliveStateForTests();
  });

  /** 跑一轮、接管 assistant、收尾并等宽限到期——单元出表、映射交接到 idle。 */
  async function settleAndHandOver(
    assistant: ChatMessageData,
  ): Promise<string> {
    startRun(h, 's', 'r1');
    await h.manager.loadSessionTailMessages('s', {force: true});
    const streamId = h.manager.snapshot('s')?.streamRows[0]?.streamId ?? '';
    publishText(h.eventBus, 's', 'r1', 'answer');
    advanceStreamTimers();
    publishStep(h.eventBus, 's', 'r1', 'assistant', assistant.id);
    await flushAsync();
    publishFinished(h.eventBus, 's', 'r1');
    await flushAsync();
    jest.advanceTimersByTime(1000);
    expect(h.manager.snapshot('s')).toBe(null);
    return streamId;
  }

  it('单元出表交接到 idle：tail 刷新不丢，新 startRun 从 idle 继承', async () => {
    const assistant = makeAssistant('s', 2);
    h.db.set('s', [makeUser('s', 1), assistant]);
    const streamId = await settleAndHandOver(assistant);

    const idle = h.manager.readMessagesSnapshot('s');
    expect(idle?.messages.length).toBeGreaterThan(0);
    expect(idle?.streamRowIds.get(assistant.id)).toBe(streamId);

    // idle tail 刷新必须保留映射（否则已接管行回退 DB id → remount）
    await h.manager.loadSessionTailMessages('s', {
      force: true,
      projectId: 'p',
    });
    expect(
      h.manager.readMessagesSnapshot('s')?.streamRowIds.get(assistant.id),
    ).toBe(streamId);

    // 新 run 无旧单元：从 idle 承接，不因空 Map 遮蔽（P1-3）
    startRun(h, 's', 'r2');
    expect(h.manager.snapshot('s')?.streamRowIds.get(assistant.id)).toBe(
      streamId,
    );
  });

  it('消费型单元首次 lazy 建立时从 idle 继承映射（P1-3）', async () => {
    const assistant = makeAssistant('s', 2);
    h.db.set('s', [makeUser('s', 1), assistant]);
    const streamId = await settleAndHandOver(assistant);
    expect(
      h.manager.readMessagesSnapshot('s')?.streamRowIds.get(assistant.id),
    ).toBe(streamId);

    // 无单元时的 RUN_STARTED（subagent 子会话 run）→ adoptConsumptiveUnit
    publishStarted(h.eventBus, 's', 'child-run');
    expect(h.manager.snapshot('s')?.status).toBe('running');
    expect(h.manager.snapshot('s')?.streamRowIds.get(assistant.id)).toBe(
      streamId,
    );
  });

  it('removeUnit 合并两代映射后有界 200（P1-3）', async () => {
    h.db.set('s', [makeUser('s', 1)]);
    startRun(h, 's', 'r1');
    await h.manager.loadSessionTailMessages('s', {force: true});
    for (let i = 0; i < 200; i += 1) {
      publishText(h.eventBus, 's', 'r1', `t${i}`);
      advanceStreamTimers();
      publishStep(h.eventBus, 's', 'r1', 'assistant', `bulk-${i}`);
    }
    await flushAsync();
    expect(h.manager.snapshot('s')?.streamRowIds.size).toBe(200);
    publishFinished(h.eventBus, 's', 'r1');
    await flushAsync();
    jest.advanceTimersByTime(1000);
    expect(h.manager.readMessagesSnapshot('s')?.streamRowIds.size).toBe(200);

    // 第二轮继承 200 条后再接管一条新行：单元侧有界化丢最旧
    startRun(h, 's', 'r2');
    await h.manager.loadSessionTailMessages('s', {force: true});
    publishText(h.eventBus, 's', 'r2', 'fresh');
    advanceStreamTimers();
    publishStep(h.eventBus, 's', 'r2', 'assistant', 'fresh-db');
    expect(h.manager.snapshot('s')?.streamRowIds.size).toBe(200);
    expect(h.manager.snapshot('s')?.streamRowIds.has('fresh-db')).toBe(true);

    // 出表交接：idle 200 + 单元 200 合并后仍封顶 200（丢最旧 bulk-0）
    publishFinished(h.eventBus, 's', 'r2');
    await flushAsync();
    jest.advanceTimersByTime(1000);
    const idle = h.manager.readMessagesSnapshot('s');
    expect(idle?.streamRowIds.size).toBe(200);
    expect(idle?.streamRowIds.has('fresh-db')).toBe(true);
    expect(idle?.streamRowIds.has('bulk-0')).toBe(false);
  });

  it('requestStreamReset：投影为空时不广播 reset-stream，只补 force-snapshot（P1-4）', async () => {
    const assistant = makeAssistant('s', 1);
    h.db.set('s', [assistant]);
    startRun(h, 's', 'r1');
    const streamId = h.manager.snapshot('s')?.streamRows[0]?.streamId;
    publishText(h.eventBus, 's', 'r1', 'answer');
    advanceStreamTimers();
    publishStep(h.eventBus, 's', 'r1', 'assistant', assistant.id);
    await flushAsync();
    publishFinished(h.eventBus, 's', 'r1');
    await flushAsync();
    expect(h.manager.snapshot('s')?.streamRows).toEqual([]);

    const recorder = recordingHandle('w');
    h.manager.attachWebview('s', recorder.handle);
    h.manager.requestStreamReset('s');
    jest.advanceTimersByTime(0);

    expect(recorder.controls).toEqual([{type: 'force-snapshot'}]);
    expect(h.manager.snapshot('s')?.streamRowIds.get(assistant.id)).toBe(
      streamId,
    );
  });
});
