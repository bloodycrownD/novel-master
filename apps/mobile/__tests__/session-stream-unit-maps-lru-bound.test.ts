/**
 * T-AM1-4/5：manager 里两张按 sessionId 键的常驻表必须挂 500 LRU。
 *
 * 病灶：`settledProjections` 与 `idleMessageViews` 都是无上界的 `new Map`。
 * 前者存每次 run 收尾的常驻投影，后者存**无单元会话的消息全文深拷贝**——
 * 用户长期使用即单调增长，`SESSION_STREAM_MAX_SETTLED_UNITS = 8` 那个 LRU
 * 只管 `units`，管不到它们。
 *
 * 观测面是「size 探针 + 具体 id 的读口」，不是「map 里没有这个 key」这种
 * 可被实现换形态绕开的弱观测。
 *
 * 独立文件（独立 jest 进程）：`runStartupMaintenanceOnce` 一类进程级标记
 * 不能被同文件首条用例消费掉。
 */
import {describe, expect, it, jest, afterEach} from '@jest/globals';
import {SimpleEventBus} from '@novel-master/core/events';
import {
  SessionStreamUnitManager,
  SESSION_STREAM_MAX_MESSAGE_VIEWS,
} from '@/services/session-stream-unit-manager.service';
import {clearAllSessionViewCaches} from '@/services/chat-session-view-cache';

const CAP = SESSION_STREAM_MAX_MESSAGE_VIEWS;

const liveManagers: SessionStreamUnitManager[] = [];

afterEach(() => {
  while (liveManagers.length > 0) {
    liveManagers.pop()?.dispose();
  }
  clearAllSessionViewCaches();
});

/** 造一条 settled run_state 行（hydrate 的回填源）。 */
function settledRow(sessionId: string) {
  return {
    sessionId,
    projectId: 'p1',
    runId: `run-${sessionId}`,
    startedAtMs: 1,
    updatedAtMs: 2,
    textChars: 10,
    thinkingChars: 0,
    completionTokens: 20,
    tokenSource: 'provider',
    partialText: '',
    partialThinking: '',
  };
}

/**
 * 新建 manager。
 * - `runStateService.listByStatuses(['settled'])` 返回灌好的 settled 行，
 *   走 hydrate 的回填分支写 settledProjections；
 * - `yieldQuantum` 注同步 mock：hydrate 是**逐行 await** 的，
 *   用真实量子会让 CAP+1 次让步把用例拖到超时。
 */
function createManager(opts: {
  readonly settledSessions: readonly string[];
  readonly skipHydrate?: boolean;
}): SessionStreamUnitManager {
  const runtime = {
    eventBus: new SimpleEventBus(),
    abortRegistry: {
      has: jest.fn(() => false),
      abort: jest.fn(),
      register: jest.fn(),
      unregister: jest.fn(),
    },
    sessions: {get: jest.fn(async (id: string) => ({id, title: id}))},
    projects: {get: jest.fn(async (id: string) => ({id, name: id}))},
    // sessionKkv 缺省 ⇒ readFinalRateRaw 直接回 null，不额外读库。
  } as never;
  const manager = new SessionStreamUnitManager({
    runtime,
    runAgentTurn: jest.fn(async () => undefined) as never,
    runStateService: {
      listByStatuses: jest.fn(async (statuses: readonly string[]) =>
        statuses.includes('settled')
          ? opts.settledSessions.map(settledRow)
          : [],
      ),
    } as never,
    yieldQuantum: async () => undefined,
  });
  liveManagers.push(manager);
  if (opts.skipHydrate !== true) {
    manager.markHydrated();
  }
  return manager;
}

/** 灌 idleMessageViews：公开入口 hydrateSessionMessages（无单元即写入）。 */
function fillIdleViews(
  manager: SessionStreamUnitManager,
  count: number,
  start = 0,
): void {
  for (let i = start; i < start + count; i++) {
    manager.hydrateSessionMessages('p1', `idle-${i}`);
  }
}

describe('AM-1 两张常驻表挂 500 LRU', () => {
  it('T-AM1-4 idleMessageViews 插入 CAP+1 → size 封顶且最旧淘汰', () => {
    const manager = createManager({settledSessions: [], skipHydrate: true});
    manager.markHydrated();
    fillIdleViews(manager, CAP + 1);
    expect(manager.idleMessageViewsSize()).toBe(CAP);
    // 最早写入的那个已被淘汰（读口回 null）
    expect(manager.readMessagesSnapshot('idle-0')).toBeNull();
    // 最近的还在
    expect(manager.readMessagesSnapshot(`idle-${CAP}`)).not.toBeNull();
  });

  it('T-AM1-4 settledProjections 插入 CAP+1 → size 封顶且最旧淘汰', async () => {
    const sessions = Array.from({length: CAP + 1}, (_, i) => `s-${i}`);
    const manager = createManager({settledSessions: sessions});
    await manager.hydrate();
    expect(manager.settledProjectionsSize()).toBe(CAP);
    // 最早写入的投影已被淘汰（读口回 null）
    expect(manager.getSettledProjection('s-0')).toBeNull();
    // 最近的还在
    expect(manager.getSettledProjection(`s-${CAP}`)).not.toBeNull();
  });

  it('T-AM1-5 LRU 命中刷新新鲜度 → 最近读过的会话不被淘汰', () => {
    const manager = createManager({settledSessions: [], skipHydrate: true});
    manager.markHydrated();
    fillIdleViews(manager, CAP);
    // 刷新最旧那条的新鲜度（命中即 delete+set 重排）
    expect(manager.readMessagesSnapshot('idle-0')).not.toBeNull();
    // 再灌一条新的 ⇒ 淘汰的应该是现在的最旧（idle-1），而不是刚读过的 idle-0
    fillIdleViews(manager, 1, CAP);
    expect(manager.idleMessageViewsSize()).toBe(CAP);
    expect(manager.readMessagesSnapshot('idle-0')).not.toBeNull();
    expect(manager.readMessagesSnapshot('idle-1')).toBeNull();
  });
});
