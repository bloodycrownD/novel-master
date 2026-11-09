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
import {SessionStreamUnitManager} from '@/services/session-stream-unit-manager.service';
import {
  SESSION_STREAM_APPLY_INTERVAL_MS,
  SESSION_STREAM_INGRESS_COALESCE_MS,
  SessionStreamUnit,
} from '@/services/session-stream-unit';
import type {SessionStreamWebviewHandle} from '@/services/session-stream-unit';
import {resetKeepAliveStateForTests} from '@/services/agent-finished-notification';
import type {ChatMessageData} from '@novel-master/core/chat';

const CLOCK_START_MS = 2_000_000;

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

function createHarness() {
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
): void {
  eventBus.publish(EVENT_AGENT_STEP_COMMITTED, {
    sessionId,
    projectId: 'p',
    runId,
    phase,
  });
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

    const removed = unit.clearStreamProjection();
    expect(removed).toEqual([rows[0]?.streamId]);
    expect(unit.snapshot().streamRows).toEqual([]);
    expect(unit.snapshot().partialText).toBe('');
    unit.destroy();
  });
});
