/**
 * T-AM1-1/2/3：删除链路必须补调 `sessionStreamUnitManager.forgetSession`。
 *
 * 病灶：`forgetSession` 的 JSDoc 明写「Step 6 会话删除链路调用」，
 * 但生产调用方为 0 ⇒ 用户删了会话，manager 里四张常驻表（idleMessageViews /
 * settledProjections / pendingChildParentByChild / units 活跃 refcount）全部残留，
 * 其中 idleMessageViews 存的是**消息全文深拷贝**——会话已从库里删掉、UI 上也看不到了，
 * 内存里还留着。
 *
 * 夹具从 use-chat-tab-scope-batch-delete.test.ts 整份复制（同样的 mock runtime 骨架、
 * 同样的 chat-agent-meta / chat-prompt-tokens mock）。独立成文件的原因：jest 的
 * `jest.mock` 按文件隔离，塞进既有文件会与它自己的期望族交织。
 *
 * 观测面是 `forgetSession` 的**调用参数序列**（注入缝，与实现同源且可注入），
 * 不是「map 里没有这个 key」这种可被实现换形态绕开的弱观测。
 */
import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {useChatTabScope} from '../src/screens/tabs/chat-tab/useChatTabScope';

/** 本文件挂过的 renderer；统一在 afterEach 里于 act 内卸载。 */
const mounted: TestRenderer.ReactTestRenderer[] = [];

jest.mock('../src/services/chat-agent-meta', () => ({
  loadChatAgentMeta: jest.fn(async () => ({
    source: 'session',
    agentId: 'a1',
    agentName: 'Agent',
    modelLabel: 'Model',
    tokenLabel: '',
    hasDedicatedModel: false,
    modelSource: 'session',
  })),
}));

jest.mock('../src/services/chat-prompt-tokens.service', () => ({
  loadChatPromptTokenLabelResilient: jest.fn(async () => ''),
  isChatTokenPreciseWarmInflight: jest.fn(() => false),
  // 防御性补键（tokenizer-native-cancel）：hook 的换 key 分支 / 卸载 cleanup
  // 也会调 cancelPreciseUpgrade，缺键即 undefined 抛。
  cancelPreciseUpgrade: jest.fn(),
}));

const deletedSessionIds: string[] = [];
const deletedProjectIds: string[] = [];

/**
 * 「库里的」全部会话：两条顶层 + 一条子 agent 会话。
 *
 * ⚠️ mock 的 listByProject 刻意**复刻 core 的 SQL 过滤**（`parent_session_id IS NULL`，
 * 见 sqlite-session.repository 的 listByProject）：子 agent 会话不进返回值。
 * 这不是把缺口藏起来，而是让夹具与真实读口同构——生产侧漏清子会话的缺口是
 * 「读口本身不返回子会话」，正因如此 T-AM1-3 的负向断言才有牙。
 */
const allProjectSessionRows = [
  {id: 'p1s1', title: 'S1', updatedAtMs: 1},
  {id: 'p1s2', title: 'S2', updatedAtMs: 2},
  {id: 'p1s1c1', title: 'S1 子', updatedAtMs: 3, parentSessionId: 'p1s1'},
];

/** 复刻 listByProject 的顶层过滤。 */
const topLevelRows = () =>
  allProjectSessionRows.filter(r => r.parentSessionId == null);

const mockRuntime: any = {
  projects: {
    list: jest.fn(async () => [{id: 'p1', name: 'P1'}]),
    get: jest.fn(async () => ({id: 'p1', name: 'P1'})),
    delete: jest.fn(async (id: string) => {
      deletedProjectIds.push(id);
    }),
  },
  sessions: {
    listByProject: jest.fn(async () => topLevelRows()),
    delete: jest.fn(async (id: string) => {
      deletedSessionIds.push(id);
    }),
  },
  state: {
    getCurrentModelId: jest.fn(async () => 'openai/gpt-4o-mini'),
  },
  sessionVfs: jest.fn(() => ({})),
  workplace: jest.fn(() => ({})),
  projectVfs: jest.fn(() => ({})),
  sessionStreamUnitManager: {
    forgetSession: jest.fn(),
  },
};

const mockShowToast = jest.fn();
const mockRefreshScope = jest.fn(async () => undefined);
const mockExitSessionBatch = jest.fn();

/**
 * 挂载并**在 act 内排空**挂载即发起的异步读。
 *
 * ⚠️ useChatTabScope 挂载即发起 refreshChatMeta / chat token label 两路异步读，
 * 它们的 setState 若落在 act 之外 ⇒ jest 收尾时刷
 * 「An update to Harness inside a test was not wrapped in act(...)」/
 * 「Cannot log after tests are done」。act 未生效时 React 的批处理与 effect 时序
 * 与真实渲染不同源，正是 spec §1 反复强调的偏差源，所以这里排空而不是忽略。
 * ⚠️ 渲染器另存在 `mounted` 里，由 afterEach 统一于 act 内卸载（原来从不卸载）。
 */
async function mountScope() {
  let api: ReturnType<typeof useChatTabScope> | undefined;
  function Harness() {
    api = useChatTabScope({
      runtime: mockRuntime,
      projectId: 'p1',
      sessionId: 's1',
      setCurrentProject: jest.fn(async () => undefined),
      setCurrentSession: jest.fn(async () => undefined),
      refreshScope: mockRefreshScope,
      showToast: mockShowToast,
      navigation: {navigate: jest.fn()} as any,
    });
    return null;
  }
  await act(async () => {
    mounted.push(TestRenderer.create(React.createElement(Harness)));
  });
  return api!;
}

beforeEach(() => {
  mounted.length = 0;
});

afterEach(async () => {
  await act(async () => {
    for (const r of mounted.splice(0)) {
      r.unmount();
    }
  });
});

function forgottenIds(): string[] {
  return mockRuntime.sessionStreamUnitManager.forgetSession.mock.calls.map(
    (c: unknown[]) => c[0] as string,
  );
}

describe('AM-1 删除链路补调 forgetSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deletedSessionIds.length = 0;
    deletedProjectIds.length = 0;
    mockRuntime.sessions.delete.mockImplementation(async (id: string) => {
      deletedSessionIds.push(id);
    });
    mockRuntime.projects.delete.mockImplementation(async (id: string) => {
      deletedProjectIds.push(id);
    });
    mockRuntime.sessions.listByProject.mockImplementation(async () =>
      topLevelRows(),
    );
  });

  it('T-AM1-1 单个删除成功 → forgetSession(id) 恰一次；删除失败 → 零次', async () => {
    const api = await mountScope();
    await act(async () => {
      await api.handleDeleteSession('s9');
    });
    expect(forgottenIds()).toEqual(['s9']);
    expect(
      mockRuntime.sessionStreamUnitManager.forgetSession,
    ).toHaveBeenCalledTimes(1);

    // 失败路径不得误清：delete 抛错 ⇒ forget 零次（否则会清掉还活着的会话状态）
    mockRuntime.sessionStreamUnitManager.forgetSession.mockClear();
    mockRuntime.sessions.delete.mockImplementation(async () => {
      throw new Error('db locked');
    });
    await act(async () => {
      await api.handleDeleteSession('s10');
    });
    expect(
      mockRuntime.sessionStreamUnitManager.forgetSession,
    ).not.toHaveBeenCalled();
  });

  it('T-AM1-2 批量删除部分成功 → 只 forget 已删成功的，失败及其后的不清', async () => {
    mockRuntime.sessions.delete.mockImplementation(async (id: string) => {
      if (id === 's2') {
        throw new Error('db locked');
      }
      deletedSessionIds.push(id);
    });
    const api = await mountScope();
    await act(async () => {
      await api.deleteSelectedSessions(
        new Set(['s1', 's2', 's3']),
        mockExitSessionBatch,
      );
    });
    // s1 删成功 ⇒ 立刻 forget；s2 抛错停住，s2/s3 根本没删 ⇒ 不得清
    expect(forgottenIds()).toEqual(['s1']);
    expect(deletedSessionIds).toEqual(['s1']);
  });

  it('T-AM1-3 项目删除成功 → 该项目顶层会话被 forget；失败 → 零次；子 agent 会话不被 forget（已知缺口）', async () => {
    const api = await mountScope();
    await act(async () => {
      await api.handleDeleteProjects(['p1']);
    });
    const ids = forgottenIds();
    expect(ids).toContain('p1s1');
    expect(ids).toContain('p1s2');
    // 负向断言（这条断言的就是「漏清」这个已知缺口本身）：
    // 读口 listByProject 硬编码 parent_session_id IS NULL，子 agent 会话不在返回值里，
    // 于是项目删除后 manager 仍留着它的条目，靠 500 LRU 兜底而不是被回收。
    // 将来 core 侧补上 BFS 读口后，这条会翻红并提醒把缺口回收掉。
    expect(ids).not.toContain('p1s1c1');

    // projects.delete 抛错 ⇒ 一个都不许清
    mockRuntime.sessionStreamUnitManager.forgetSession.mockClear();
    mockRuntime.projects.delete.mockImplementation(async () => {
      throw new Error('fs busy');
    });
    await act(async () => {
      await api.handleDeleteProjects(['p1']);
    });
    expect(
      mockRuntime.sessionStreamUnitManager.forgetSession,
    ).not.toHaveBeenCalled();
  });
});
