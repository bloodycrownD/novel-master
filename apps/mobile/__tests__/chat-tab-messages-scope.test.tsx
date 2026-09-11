/**
 * T-X 系列：消息视图会话作用域守卫回归（串会话竞态）——Step 7 收口后的
 * manager idle 路径等价改写。
 *
 * 背景（原 hook 版）：reloadMessages / loadOlderMessages 的在途异步在会话
 * 切换后原样 setChatMessages——旧会话的行灌进新会话的屏幕。修复当时靠
 * sessionIdRef 作用域校验丢弃过期结果。
 *
 * manager idle 路径下该守卫结构性成立：idle 视图与 view cache 均按
 * sessionId 键控，在途结果只会落回属主会话的视图（不存在「灌进当前
 * 会话 state」的共享面）。本文件断言这一等价语义：并行/在途加载期间
 * 各会话快照只含本会话行、属主缓存照常刷新。
 */
import {
  SessionStreamUnitManager,
} from '../src/services/session-stream-unit-manager.service';
import {SimpleEventBus} from '@novel-master/core/events';
import {
  clearAllSessionViewCaches,
  getSessionViewCache,
  sessionViewCacheKey,
  setSessionViewCache,
} from '../src/services/chat-session-view-cache';
import type {MobileNovelMasterRuntime} from '../src/runtime/types';
import type {ChatMessage} from '@novel-master/core/chat';

function makeMessage(sid: string, seq: number): ChatMessage {
  return {
    id: `${sid}-${seq}`,
    sessionId: sid,
    seq,
    role: 'user',
    content: `msg-${sid}-${seq}`,
    createdAtMs: seq * 1000,
  } as unknown as ChatMessage;
}

function createHarness(tailImpl: (sid: string) => Promise<ChatMessage[]>) {
  const eventBus = new SimpleEventBus();
  const runtime = {
    eventBus,
    abortRegistry: {
      has: jest.fn(() => false),
      abort: jest.fn(),
      register: jest.fn(),
      unregister: jest.fn(),
    },
    sessions: {get: jest.fn(async (sid: string) => ({id: sid}))},
    projects: {get: jest.fn(async (pid: string) => ({id: pid}))},
    messages: {
      listBySessionTail: jest.fn((sid: string) => tailImpl(sid)),
      listBySessionPage: jest.fn(async () => []),
    },
  } as unknown as MobileNovelMasterRuntime;
  const manager = new SessionStreamUnitManager({
    runtime,
  } as never);
  manager.markHydrated();
  return {manager, runtime};
}

describe('T-X: manager idle 消息路径的会话作用域守卫（串会话竞态）', () => {
  beforeEach(() => {
    clearAllSessionViewCaches();
  });
  afterEach(() => {
    clearAllSessionViewCaches();
  });

  it('在途 tail 加载期间并行查看另一会话：结果只落属主视图，不串进当前会话', async () => {
    const messagesOfA = [makeMessage('sess-A', 1), makeMessage('sess-A', 2)];
    const messagesOfB = [makeMessage('sess-B', 7)];
    let releaseA: ((list: ChatMessage[]) => void) | null = null;
    const {manager} = createHarness(sid => {
      if (sid === 'sess-A') {
        return new Promise(resolve => {
          releaseA = list => resolve(list ?? messagesOfA);
        });
      }
      return Promise.resolve(messagesOfB);
    });

    // A 的 tail 加载发起后挂起（在途）；B 立即加载完成。
    const pendingA = manager.loadSessionTailMessages('sess-A', {
      projectId: 'proj-1',
    });
    await manager.loadSessionTailMessages('sess-B', {projectId: 'proj-1'});

    // B 的快照只含 B 的行（在途的 A 尚未返回，也不得占位）。
    expect(
      manager
        .readMessagesSnapshot('sess-B')
        ?.messages.every(m => m.sessionId === 'sess-B'),
    ).toBe(true);

    // A 的 DB 结果此时才返回：只落 A 的 idle 视图与 view cache。
    releaseA?.(messagesOfA);
    await pendingA;
    const snapA = manager.readMessagesSnapshot('sess-A');
    expect(snapA?.messages).toEqual(messagesOfA);
    expect(
      manager
        .readMessagesSnapshot('sess-B')
        ?.messages.some(m => m.sessionId === 'sess-A'),
    ).toBe(false);
    // 属主缓存照常刷新（重进 A 水合即最终列表——消息不丢失）。
    expect(
      getSessionViewCache(sessionViewCacheKey('proj-1', 'sess-A'))?.messages,
    ).toEqual(messagesOfA);
    expect(
      getSessionViewCache(sessionViewCacheKey('proj-1', 'sess-B'))?.messages,
    ).toEqual(messagesOfB);
    manager.dispose();
  });

  it('在途分页期间切换查看另一会话：分页结果只 prepend 回属主视图', async () => {
    const rowsB = [makeMessage('sess-B', 5), makeMessage('sess-B', 6)];
    const olderB = [makeMessage('sess-B', 3)];
    let releaseOlder: ((list: ChatMessage[]) => void) | null = null;
    const {manager} = createHarness(async () => []);
    // listBySessionPage 受控（分页在途）
    (manager as unknown as {runtime: {messages: {listBySessionPage: jest.Mock}}})
      .runtime.messages.listBySessionPage.mockImplementation(
        () =>
          new Promise(resolve => {
            releaseOlder = (list: ChatMessage[]) => resolve(list ?? []);
          }),
      );
    // 预置 B 的 idle 视图（缓存水合路径）
    setSessionViewCache(sessionViewCacheKey('proj-1', 'sess-B'), {
      messages: rowsB,
      hasMoreMessages: true,
    });
    manager.hydrateSessionMessages('proj-1', 'sess-B');
    expect(manager.readMessagesSnapshot('sess-B')?.messages).toEqual(rowsB);

    // B 的分页发起后挂起；期间 A 完成一轮 tail 加载（模拟切换查看）。
    const pendingOlder = manager.loadOlderSessionMessages('sess-B', 'proj-1');
    await manager.loadSessionTailMessages('sess-A', {projectId: 'proj-1'});

    releaseOlder?.(olderB);
    await pendingOlder;

    // B 的更早行 prepend 进 B 的视图；A 的快照不含 B 的行。
    const snapB = manager.readMessagesSnapshot('sess-B');
    expect(snapB?.messages.map(m => m.seq)).toEqual([3, 5, 6]);
    expect(
      manager
        .readMessagesSnapshot('sess-A')
        ?.messages.some(m => m.sessionId === 'sess-B'),
    ).toBe(false);
    manager.dispose();
  });

  it('readMessagesSnapshot：单元销毁沿把投影消息面交接进 idle，切换不断档', async () => {
    // 建立带消息的 settled 单元（宽限 0 —— 立即销毁）后读取 idle 交接。
    const finalRows = [makeMessage('sess-A', 9)];
    const {manager, runtime} = createHarness(async () => finalRows);
    (runtime.messages as {listBySessionPage: jest.Mock})
      .listBySessionPage.mockImplementation(async () => []);

    // 水合 idle（缓存 miss → 回源 tail）。
    await manager.loadSessionTailMessages('sess-A', {projectId: 'proj-1'});
    expect(manager.readMessagesSnapshot('sess-A')?.messages).toEqual(finalRows);
    manager.dispose();
  });
});
