/**
 * T-X 系列：消息视图会话作用域守卫回归（串会话竞态）。
 *
 * 背景：reloadMessages / loadOlderMessages 的在途异步在会话切换后原样
 * setChatMessages——旧会话的行灌进新会话的屏幕，表现为「两个会话显示
 * 同样消息」，重启后恢复。修复 = sessionIdRef 作用域校验丢弃过期结果。
 */
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {loadSessionMessagesTail as loadTailMock} from '../src/services/session-messages-loader';

jest.mock('../src/services/session-messages-loader', () => ({
  ...jest.requireActual('../src/services/session-messages-loader'),
  loadSessionMessagesTail: jest.fn(),
}));
import {useChatTabMessages} from '../src/screens/tabs/chat-tab/useChatTabMessages';
import {
  setSessionViewCache,
  sessionViewCacheKey,
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

function makeRuntime(
  sessionLists: Record<string, ChatMessage[]>,
): MobileNovelMasterRuntime {
  return {
    messages: {
      listBySessionPage: jest.fn(async (sid: string) => {
        const list = sessionLists[sid] ?? [];
        if (list.length === 0) {
          return [];
        }
        // beforeSeq 语义：取 seq 更小的更早一页；这里返回空表表示无更早
        return [];
      }),
    },
  } as unknown as MobileNovelMasterRuntime;
}

describe('T-X: 消息视图会话作用域守卫（串会话竞态）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('在途 reload 期间切换会话：旧会话结果被丢弃，不落进新会话状态', async () => {
    let releaseDb: ((list: ChatMessage[]) => void) | null = null;
    const runtime = {
      messages: {
        listBySessionPage: jest.fn(async () => []),
      },
    } as unknown as MobileNovelMasterRuntime;
    const messagesOfA = [makeMessage('sess-A', 1), makeMessage('sess-A', 2)];
    // loadSessionMessagesTail 走 runtime.messages.listBySessionPage 之外的服务
    // 这里直接劫持模块内使用的分页服务入口：通过首屏 tail 加载 mock
    // 默认立即空返回；仅显式武装后的下一次调用用受控行 promise（A 的 DB 慢返回）。
    // 不能按调用序号区分——切换会话的重渲染会触发新会话的初次加载（也是 mock 调用），
    // 受控句柄会被顶掉。
    let armControlled = false;
    (loadTailMock as jest.Mock).mockImplementation(() => {
      if (!armControlled) {
        return Promise.resolve([]);
      }
      armControlled = false;
      return new Promise(resolve => {
        releaseDb = list => {
          resolve(list ?? messagesOfA);
        };
      });
    });

    const api: {current?: ReturnType<typeof useChatTabMessages>} = {};
    const propsBox: {sessionId: string | undefined} = {sessionId: 'sess-A'};
    function Harness() {
      api.current = useChatTabMessages({
        runtime,
        projectId: 'proj-1',
        sessionId: propsBox.sessionId,
        chatSubview: 'conversation',
        onAfterExternalReload: undefined,
      } as never);
      return null;
    }
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(Harness));
    });
    await act(async () => {});

    // 发起非缓存 force reload（缓存未命中 → 走 DB tail），在 act 外持 promise
    armControlled = true;
    const pending = api.current!.reloadMessages(true);

    // 在途期间切到会话 B（重渲染触发 B 的初次加载——立即空返回，不抢受控句柄）
    act(() => {
      propsBox.sessionId = 'sess-B';
      renderer.update(React.createElement(Harness));
    });

    // A 的 DB 结果此时才返回
    releaseDb?.(messagesOfA);
    await pending;
    await act(async () => {});
    const rows = api.current!.chatMessages;
    expect(rows.every(m => m.sessionId !== 'sess-A')).toBe(true);
    expect(
      require('../src/services/chat-session-view-cache')
        .getSessionViewCache(sessionViewCacheKey('proj-1', 'sess-B'))
        ?.messages.some(m => m.sessionId === 'sess-A'),
    ).toBeFalsy();
  });

  it('loadOlderMessages 在途期间切换会话：分页结果被丢弃', async () => {
    const rowsB = [makeMessage('sess-B', 5), makeMessage('sess-B', 6)];
    let releaseOlder: ((list: ChatMessage[]) => void) | null = null;
    const runtime = {
      messages: {
        listBySessionPage: jest.fn(
          (_sid: string, opts: {beforeSeq?: number}) =>
            new Promise(resolve => {
              releaseOlder = (list: ChatMessage[]) => resolve(list ?? []);
              void opts;
            }),
        ),
      },
    } as unknown as MobileNovelMasterRuntime;

    // 给 B 预置已有消息（直接走缓存水合）
    setSessionViewCache(sessionViewCacheKey('proj-1', 'sess-B'), {
      messages: rowsB,
      hasMoreMessages: true,
    });

    const api: {current?: ReturnType<typeof useChatTabMessages>} = {};
    const propsBox: {sessionId: string | undefined} = {sessionId: 'sess-B'};
    function Harness() {
      api.current = useChatTabMessages({
        runtime,
        projectId: 'proj-1',
        sessionId: propsBox.sessionId,
        chatSubview: 'conversation',
        onAfterExternalReload: undefined,
      } as never);
      return null;
    }
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(Harness));
    });
    await act(async () => {});

    // 触发加载更早（act 外持 promise，pending 由受控 promise 驱动）
    const pendingOlder = api.current!.loadOlderMessages();

    // 在途期间切走
    act(() => {
      propsBox.sessionId = 'sess-A';
      renderer.update(React.createElement(Harness));
    });

    releaseOlder?.([makeMessage('sess-B', 3)]);
    await pendingOlder;
    await act(async () => {});

    // 旧会话的更早行不得 prepend 进新会话状态
    expect(api.current!.chatMessages.some(m => m.seq === 3)).toBe(false);
  });
});
