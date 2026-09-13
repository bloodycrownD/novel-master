/**
 * 会话流式单元消息管线测试（Step 4：tail 加载/分页/step 级 reload/
 * view cache 写入/force 快照驱动）。
 *
 * mock 手法沿用 session-stream-unit-pipeline.test.ts 的 harness 形状
 * （SimpleEventBus + mock runtime + 注入 runAgentTurn），另加内存型
 * messages 仓库（tail/page 口径与 core 对齐：seq 升序、tail 取尾部 N 条、
 * page 取 beforeSeq 之前的尾部 N 条）与视图缓存逐例清空。
 *
 * 覆盖：
 * - T-U5：单元消息隔离——两个并行会话各自单元的消息加载/缓存只含本会话行
 *   （T-X 等价断言：作用域守卫随单元化结构性消失，结果只落回自己家）；
 * - T-U5：后台收尾缓存刷新——会话 B 无 attach 时其 FINISHED 后 view cache
 *   仍被刷新，重进（非 force load）即最新（消息丢失回归）；
 * - hydrate 语义：缓存命中不回源 DB、miss 回源并写缓存；
 * - 分页：tail 40 + hasMore 探针 → 向上翻页补齐、缓存同步；
 * - step 级 reload：STEP_COMMITTED 冲刷 partial 后 force 回源，落库行进
 *   消息面与缓存；
 * - T-U6：subagent 长任务期间消息可见——child 活跃期间父单元的 force
 *   快照控制消息可被驱动（child-created 登记/父收尾清空自动广播 + 屏幕
 *   侧方法直调），消息面与流式 partial 照常可取。
 */
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import {
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
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
  SESSION_STREAM_MESSAGES_PAGE_SIZE,
} from '@/services/session-stream-unit';
import type {SessionStreamWebviewHandle} from '@/services/session-stream-unit';
import {
  clearAllSessionViewCaches,
  getSessionViewCache,
  sessionViewCacheKey,
  setSessionViewCache,
} from '@/services/chat-session-view-cache';
import {resetKeepAliveStateForTests} from '@/services/agent-finished-notification';
import type {ChatMessage} from '@novel-master/core/chat';

/** 时钟起点（fake timers 的 Date.now 从此起算）。 */
const CLOCK_START_MS = 1_000_000;

/** 等待内部 fire-and-forget reload（多层 async 链）落地所需的微任务轮数。 */
async function flushAsync(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

/** 推过两段缓冲（32ms 合并 + 64ms apply）所需的全部时间。 */
function advanceStreamTimers(extraMs = 10): void {
  jest.advanceTimersByTime(
    SESSION_STREAM_INGRESS_COALESCE_MS +
      SESSION_STREAM_APPLY_INTERVAL_MS +
      extraMs,
  );
}

function makeMessage(
  sid: string,
  seq: number,
  role: 'user' | 'assistant' = 'user',
): ChatMessage {
  return {
    id: `${sid}-${seq}`,
    sessionId: sid,
    seq,
    role,
    content: `msg-${sid}-${seq}`,
    createdAtMs: seq * 1000,
  } as unknown as ChatMessage;
}

/**
 * 内存型消息仓库：db 按 sessionId 存 seq 升序全量行。
 * tail = 尾部 limit 条；page = beforeSeq 之前的尾部 limit 条（core 口径）。
 */
function makeMessageStore(db: Map<string, ChatMessage[]>) {
  return {
    listBySessionTail: jest.fn(
      async (sid: string, options: {limit: number}): Promise<ChatMessage[]> => {
        const rows = [...(db.get(sid) ?? [])].sort((a, b) => a.seq - b.seq);
        return rows.slice(-options.limit);
      },
    ),
    listBySessionPage: jest.fn(
      async (
        sid: string,
        options: {limit: number; beforeSeq?: number},
      ): Promise<ChatMessage[]> => {
        const rows = [...(db.get(sid) ?? [])].sort((a, b) => a.seq - b.seq);
        const filtered =
          options.beforeSeq == null
            ? rows
            : rows.filter(r => r.seq < options.beforeSeq);
        return filtered.slice(-options.limit);
      },
    ),
  };
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
  const db = new Map<string, ChatMessage[]>();
  const messages = makeMessageStore(db);
  const runAgentTurn = jest.fn(
    async (_runtime: unknown, _scope: unknown, _content: string) => undefined,
  );
  const manager = new SessionStreamUnitManager({
    runtime: {eventBus, abortRegistry, sessions, projects, messages} as never,
    runAgentTurn: runAgentTurn as never,
    settledGraceMs: options?.settledGraceMs,
  });
  manager.markHydrated();
  return {eventBus, abortRegistry, manager, db, messages, runAgentTurn};
}

function publishStarted(
  eventBus: SimpleEventBus,
  sessionId: string,
  runId: string,
  projectId = 'p',
): void {
  eventBus.publish(EVENT_AGENT_RUN_STARTED, {
    sessionId,
    projectId,
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

/** 受理 + RUN_STARTED 回填，返回 running 态单元。 */
function startRunningRun(
  h: ReturnType<typeof createHarness>,
  sessionId: string,
  runId: string,
  projectId = 'p',
): void {
  h.runAgentTurn.mockImplementation(() => new Promise(() => undefined));
  expect(h.manager.startRun(sessionId, projectId, 'hi').ok).toBe(true);
  publishStarted(h.eventBus, sessionId, runId, projectId);
}

/** 记录控制类消息的句柄（force 快照断言用）。 */
function createControlRecordingHandle(handleId: string): {
  readonly handle: SessionStreamWebviewHandle;
  readonly controls: unknown[];
} {
  const controls: unknown[] = [];
  return {
    handle: {
      handleId,
      onControlMessage: message => controls.push(message),
    },
    controls,
  };
}

beforeEach(() => {
  setMobileAgentActive(false);
  jest.clearAllMocks();
  resetKeepAliveStateForTests();
  clearAllSessionViewCaches();
  jest.useFakeTimers();
  jest.setSystemTime(CLOCK_START_MS);
});

afterEach(() => {
  jest.useRealTimers();
  setMobileAgentActive(false);
  resetKeepAliveStateForTests();
  clearAllSessionViewCaches();
});

describe('T-U5: 单元消息隔离（T-X 等价断言）', () => {
  it('两个并行会话各自单元的消息加载/缓存只含本会话行', async () => {
    const h = createHarness();
    h.db.set('sess-a', [
      makeMessage('sess-a', 1),
      makeMessage('sess-a', 2),
      makeMessage('sess-a', 3),
    ]);
    h.db.set('sess-b', [
      makeMessage('sess-b', 1),
      makeMessage('sess-b', 2),
    ]);
    startRunningRun(h, 'sess-a', 'ra', 'p1');
    startRunningRun(h, 'sess-b', 'rb', 'p2');

    await h.manager.loadSessionTailMessages('sess-a', {force: true});
    await h.manager.loadSessionTailMessages('sess-b', {force: true});

    // 消息面只含本会话的行（作用域守卫随单元化结构性消失）
    const snapA = h.manager.snapshot('sess-a');
    const snapB = h.manager.snapshot('sess-b');
    expect(snapA?.messages).toHaveLength(3);
    expect(snapA?.messages.every(m => m.sessionId === 'sess-a')).toBe(true);
    expect(snapB?.messages).toHaveLength(2);
    expect(snapB?.messages.every(m => m.sessionId === 'sess-b')).toBe(true);

    // 视图缓存按各自 (projectId, sessionId) 键落盘，只含属主会话的行
    const cacheA = getSessionViewCache(sessionViewCacheKey('p1', 'sess-a'));
    const cacheB = getSessionViewCache(sessionViewCacheKey('p2', 'sess-b'));
    expect(cacheA?.messages.every(m => m.sessionId === 'sess-a')).toBe(true);
    expect(cacheB?.messages.every(m => m.sessionId === 'sess-b')).toBe(true);

    // 回源调用按会话路由（limit = 分页大小）
    expect(h.messages.listBySessionTail).toHaveBeenCalledWith('sess-a', {
      limit: SESSION_STREAM_MESSAGES_PAGE_SIZE,
    });
    expect(h.messages.listBySessionTail).toHaveBeenCalledWith('sess-b', {
      limit: SESSION_STREAM_MESSAGES_PAGE_SIZE,
    });
  });

  it('hydrate 语义：缓存命中不回源 DB；miss 回源并写缓存', async () => {
    const h = createHarness();
    // 预置 A 的视图缓存（会话切换水合命中路径）
    setSessionViewCache(sessionViewCacheKey('p1', 'sess-a'), {
      messages: [makeMessage('sess-a', 9, 'assistant')],
      hasMoreMessages: false,
    });
    h.db.set('sess-b', [makeMessage('sess-b', 1), makeMessage('sess-b', 2)]);
    startRunningRun(h, 'sess-a', 'ra', 'p1');
    startRunningRun(h, 'sess-b', 'rb', 'p1');

    // 命中：直接采纳缓存行，不回源
    const rowsA = await h.manager.loadSessionTailMessages('sess-a');
    expect(rowsA).toHaveLength(1);
    expect(rowsA?.[0].seq).toBe(9);
    expect(h.messages.listBySessionTail).not.toHaveBeenCalled();

    // miss：回源 DB + hasMore 探针 + 写缓存
    const rowsB = await h.manager.loadSessionTailMessages('sess-b');
    expect(rowsB).toHaveLength(2);
    expect(h.messages.listBySessionTail).toHaveBeenCalledWith('sess-b', {
      limit: SESSION_STREAM_MESSAGES_PAGE_SIZE,
    });
    const cacheB = getSessionViewCache(sessionViewCacheKey('p1', 'sess-b'));
    expect(cacheB?.messages).toHaveLength(2);
    expect(cacheB?.hasMoreMessages).toBe(false); // 探针发现无更早行
  });

  it('分页：tail 40 + hasMore 探针，向上翻页补齐后缓存同步', async () => {
    const h = createHarness();
    h.db.set(
      'sess-a',
      Array.from({length: 50}, (_, i) => makeMessage('sess-a', i + 1)),
    );
    startRunningRun(h, 'sess-a', 'ra', 'p1');

    await h.manager.loadSessionTailMessages('sess-a', {force: true});
    let snap = h.manager.snapshot('sess-a');
    expect(snap?.messages).toHaveLength(SESSION_STREAM_MESSAGES_PAGE_SIZE);
    expect(snap?.messages[0].seq).toBe(11);
    expect(snap?.hasMoreMessages).toBe(true); // 探针：还有 seq<11 的行

    await h.manager.loadOlderSessionMessages('sess-a');
    snap = h.manager.snapshot('sess-a');
    expect(snap?.messages).toHaveLength(50);
    expect(snap?.messages[0].seq).toBe(1); // 更早行 prepend 到头部
    expect(snap?.messages[49].seq).toBe(50);
    expect(snap?.hasMoreMessages).toBe(false); // 不足一整页 → 无更多
    expect(snap?.loadingMoreMessages).toBe(false); // 防重入标志复位

    // 分页结果同步写视图缓存（重进水合到完整 50 行）
    const cache = getSessionViewCache(sessionViewCacheKey('p1', 'sess-a'));
    expect(cache?.messages).toHaveLength(50);
    expect(cache?.hasMoreMessages).toBe(false);
  });
});

describe('T-U5: 后台收尾缓存刷新（消息丢失回归）', () => {
  it('会话 B 无 attach 时其 FINISHED 后 view cache 仍被刷新，重进即最新', async () => {
    const h = createHarness();
    h.db.set('sess-b', [makeMessage('sess-b', 1, 'user')]);
    // 无任何 webview attach 的后台会话
    startRunningRun(h, 'sess-b', 'rb', 'p2');
    publishTextDelta(h.eventBus, 'sess-b', 'rb', '后台生成中');
    advanceStreamTimers();

    // core 落库最终 assistant 行后收尾
    h.db.get('sess-b')!.push(makeMessage('sess-b', 2, 'assistant'));
    publishFinished(h.eventBus, 'sess-b', 'rb');
    await flushAsync();

    // 单元收尾：settled 且消息面拿到最终行
    const settled = h.manager.snapshot('sess-b');
    expect(settled?.status).toBe('finished');
    expect(settled?.messages).toHaveLength(2);
    expect(settled?.messages[1].role).toBe('assistant');

    // 无 attach 也照常刷视图缓存——重进水合即最新
    const cacheB = getSessionViewCache(sessionViewCacheKey('p2', 'sess-b'));
    expect(cacheB?.messages).toHaveLength(2);
    expect(cacheB?.messages.some(m => m.role === 'assistant')).toBe(true);

    // 重进（非 force load）：缓存命中返回最终行、不再回源 DB
    const tailCallsBefore = h.messages.listBySessionTail.mock.calls.length;
    const rows = await h.manager.loadSessionTailMessages('sess-b');
    expect(rows).toHaveLength(2);
    expect(h.messages.listBySessionTail.mock.calls.length).toBe(
      tailCallsBefore,
    );
    expect(isMobileAgentActive()).toBe(false);
  });
});

describe('step 级 reload：STEP_COMMITTED 后落库行进消息面与缓存', () => {
  it('step 边界冲刷 partial 后 force 回源，拿到本 step 落库行', async () => {
    const h = createHarness();
    h.db.set('sess-a', [makeMessage('sess-a', 1, 'user')]);
    startRunningRun(h, 'sess-a', 'ra', 'p1');
    await h.manager.loadSessionTailMessages('sess-a', {force: true});
    expect(h.manager.snapshot('sess-a')?.messages).toHaveLength(1);

    // step 提交：core 已把本 step 的 assistant 行落库
    h.db.get('sess-a')!.push(makeMessage('sess-a', 2, 'assistant'));
    publishStepCommitted(h.eventBus, 'sess-a', 'ra');
    await flushAsync();

    const snap = h.manager.snapshot('sess-a');
    expect(snap?.partialText).toBe(''); // 冲刷后 partial 清零（管线语义）
    expect(snap?.messages).toHaveLength(2);
    expect(snap?.messages[1].role).toBe('assistant');
    expect(getSessionViewCache(sessionViewCacheKey('p1', 'sess-a'))?.messages)
      .toHaveLength(2);
  });
});

describe('T-U6: subagent 长任务期间消息可见（force 快照驱动）', () => {
  it('child 创建登记/父收尾清空自动广播 force-snapshot；期间消息面与流式照常可取', async () => {
    const h = createHarness();
    h.db.set('sess-a', [makeMessage('sess-a', 1, 'user')]);
    startRunningRun(h, 'sess-a', 'ra', 'p1');
    const w1 = createControlRecordingHandle('w1');
    h.manager.attachWebview('sess-a', w1.handle);
    await h.manager.loadSessionTailMessages('sess-a', {force: true});

    // 长任务开始：task 工具创建子会话 → pending 登记 + force 快照直发驱动
    publishChildCreated(h.eventBus, 'sess-a', 'child-1', '调研任务');
    expect(h.manager.snapshot('sess-a')?.pendingChildren).toEqual([
      'child-1',
    ]);
    expect(w1.controls).toEqual([{type: 'force-snapshot'}]);

    // child 活跃期间：父会话消息面照常可取、流式 partial 照常累积
    publishTextDelta(h.eventBus, 'sess-a', 'ra', '子代理跑着呢');
    advanceStreamTimers();
    const snap = h.manager.snapshot('sess-a');
    expect(snap?.messages).toHaveLength(1);
    expect(snap?.partialText).toBe('子代理跑着呢');
    expect(snap?.status).toBe('running');

    // 屏幕侧直驱入口（Step 6 接线消费）：同一控制消息可再触发
    h.manager.requestForceSnapshot('sess-a');
    expect(w1.controls).toEqual([
      {type: 'force-snapshot'},
      {type: 'force-snapshot'},
    ]);

    // 子会话 run 终态：链接保留（并行 task 批整批 fork-join，tool_results
    // 要等最慢子 agent 完成才落库，窗口期任务卡可点性由 pending 映射承担）
    // 且不广播——pending 集合未变化
    publishFinished(h.eventBus, 'child-1', 'run-child');
    await flushAsync();
    expect(h.manager.snapshot('sess-a')?.pendingChildren).toEqual([
      'child-1',
    ]);
    expect(w1.controls).toHaveLength(2); // 子终态不再触发 force 快照
    // 父 run 不受子终态影响
    expect(h.manager.snapshot('sess-a')?.status).toBe('running');

    // 父 run 收尾：链接清空（任务卡交给落库 result meta）+ force 快照广播刷新基线
    publishFinished(h.eventBus, 'sess-a', 'ra');
    expect(h.manager.snapshot('sess-a')?.pendingChildren).toEqual([]);
    expect(w1.controls).toHaveLength(3);
    expect(w1.controls[2]).toEqual({type: 'force-snapshot'});
  });

  it('force 快照广播只走控制通道，不产生流式载荷', async () => {
    const h = createHarness();
    startRunningRun(h, 'sess-a', 'ra', 'p1');
    const payloads: unknown[] = [];
    const controls: unknown[] = [];
    h.manager.attachWebview('sess-a', {
      handleId: 'w1',
      onStreamPayload: payload => payloads.push(payload),
      onControlMessage: message => controls.push(message),
    });

    publishChildCreated(h.eventBus, 'sess-a', 'child-1', '任务');
    expect(controls).toEqual([{type: 'force-snapshot'}]);
    expect(payloads).toEqual([]); // 快照驱动不是流式推送
  });
});
