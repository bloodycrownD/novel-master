/**
 * init-busy-yield Step 3 / T-C1：ChatTab 首屏查询并行化后的行为守护。
 *
 * - reloadLists：projects.get 与 sessions.listByProject 只依赖 pid、互不
 *   依赖，应并行发起（发起时间交叠）；projects.list 仍先行（pid 兜底）。
 * - refreshChatMeta：getCurrentModelId 与 loadChatAgentMeta 互不依赖，
 *   应并行发起；赋值顺序与失败语义保持。
 * - 首屏三触发（scope dep effect / Provider conversation effect /
 *   useFocusEffect）经 refreshChatMeta 内 inflight 复用合并：在途时同参
 *   重入共享一轮查询，落定后新调用新起一轮，参数变化不复用旧 inflight。
 *
 * 只 mock runtime 与 meta/token 服务；被测 hook 用真实实现。
 * 受控 deferred：挂起中「另一路已发起」即并行证明（串行版必须等前路完成）。
 */
import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {useChatTabScope} from '../src/screens/tabs/chat-tab/useChatTabScope';
import {loadChatAgentMeta} from '../src/services/chat-agent-meta';

jest.mock('../src/services/chat-agent-meta', () => ({
  loadChatAgentMeta: jest.fn(),
}));

jest.mock('../src/services/chat-prompt-tokens.service', () => ({
  loadChatPromptTokenLabelResilient: jest.fn(async () => ''),
}));

const loadChatAgentMetaMock = loadChatAgentMeta as jest.Mock;

const MOCK_META = {
  source: 'session',
  agentId: 'a1',
  agentName: 'Agent',
  modelLabel: 'Model',
  tokenLabel: '',
  hasDedicatedModel: false,
  modelSource: 'session',
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

type Deferred<T> = ReturnType<typeof createDeferred<T>>;

/** 每个用例独立 runtime：慢查询均为受控 deferred，按调用序入列待放行。 */
function buildRuntime() {
  const pendingProjectGet: Deferred<unknown>[] = [];
  const pendingSessionsList: Deferred<unknown>[] = [];
  const pendingModelId: Deferred<string>[] = [];
  const runtime: any = {
    projects: {
      list: jest.fn(async () => [{id: 'p1', name: 'P1'}]),
      get: jest.fn(() => {
        const deferred = createDeferred<unknown>();
        pendingProjectGet.push(deferred);
        return deferred.promise;
      }),
    },
    sessions: {
      listByProject: jest.fn(() => {
        const deferred = createDeferred<unknown>();
        pendingSessionsList.push(deferred);
        return deferred.promise;
      }),
    },
    state: {
      getCurrentModelId: jest.fn(() => {
        const deferred = createDeferred<string>();
        pendingModelId.push(deferred);
        return deferred.promise;
      }),
    },
    sessionVfs: jest.fn(() => ({})),
    workplace: jest.fn(() => ({})),
    projectVfs: jest.fn(() => ({})),
  };
  return {runtime, pendingProjectGet, pendingSessionsList, pendingModelId};
}

async function flushMicrotasks(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

/** 挂载真实 hook；update 支持换 sessionId（inflight 复用的 key 验证）。 */
async function mountScopeHarness(
  runtime: any,
  initial: {projectId?: string; sessionId?: string},
) {
  let api: ReturnType<typeof useChatTabScope> | undefined;
  const Harness = ({
    projectId = initial.projectId,
    sessionId = initial.sessionId,
  }: {
    projectId?: string;
    sessionId?: string;
  }) => {
    api = useChatTabScope({
      runtime,
      projectId,
      sessionId,
      setCurrentProject: jest.fn(async () => undefined),
      setCurrentSession: jest.fn(async () => undefined),
      refreshScope: jest.fn(async () => undefined),
      showToast: jest.fn(),
      navigation: {navigate: jest.fn()} as any,
    });
    return null;
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Harness, {}));
    await flushMicrotasks();
  });
  return {
    api: () => api!,
    update: async (props: {projectId?: string; sessionId?: string}) => {
      await act(async () => {
        renderer.update(React.createElement(Harness, props));
        await flushMicrotasks();
      });
    },
  };
}

describe('useChatTabScope 查询并行化（T-C1）', () => {
  let pendingMeta: Deferred<unknown>[];

  beforeEach(() => {
    jest.clearAllMocks();
    pendingMeta = [];
    loadChatAgentMetaMock.mockImplementation(() => {
      const deferred = createDeferred<unknown>();
      pendingMeta.push(deferred);
      return deferred.promise;
    });
  });

  describe('reloadLists', () => {
    it('get 与 listByProject 并行发起（发起时间交叠），结果与串行版等价', async () => {
      const {runtime, pendingProjectGet, pendingSessionsList} =
        buildRuntime();
      const scope = await mountScopeHarness(runtime, {
        projectId: 'p1',
        sessionId: 's1',
      });

      // 挂载触发的 reloadLists：projects.list 已完成（立即 resolve），
      // get 与 listByProject 均已发起且双双挂起——get 未完成时
      // listByProject 已发起，串行版必须等 get 完成后才会发起它。
      expect(runtime.projects.list).toHaveBeenCalledTimes(1);
      expect(runtime.projects.get).toHaveBeenCalledWith('p1');
      expect(runtime.sessions.listByProject).toHaveBeenCalledWith('p1');
      expect(pendingProjectGet).toHaveLength(1);
      expect(pendingSessionsList).toHaveLength(1);

      await act(async () => {
        pendingProjectGet[0].resolve({id: 'p1', name: 'P1'});
        pendingSessionsList[0].resolve([
          {id: 's1', title: 'S1', updatedAtMs: 1},
        ]);
        await flushMicrotasks();
      });

      const api = scope.api();
      expect(api.projects).toEqual([{id: 'p1', name: 'P1'}]);
      expect(api.currentProject).toEqual({id: 'p1', name: 'P1'});
      expect(api.sessions).toEqual([{id: 's1', title: 'S1', updatedAtMs: 1}]);
    });

    it('失败语义保持：get 失败不阻断 sessions；listByProject 失败向外抛且不覆盖 sessions', async () => {
      const {runtime, pendingProjectGet, pendingSessionsList} =
        buildRuntime();
      const scope = await mountScopeHarness(runtime, {
        projectId: 'p1',
        sessionId: 's1',
      });

      // 第一轮成功，sessions 落两条。
      await act(async () => {
        pendingProjectGet[0].resolve({id: 'p1', name: 'P1'});
        pendingSessionsList[0].resolve([
          {id: 's1', title: 'S1', updatedAtMs: 1},
          {id: 's2', title: 'S2', updatedAtMs: 2},
        ]);
        await flushMicrotasks();
      });
      expect(scope.api().sessions).toHaveLength(2);

      // get 失败轮：meta 置 undefined、sessions 照常刷新（原语义）。
      await act(async () => {
        void scope.api().reloadLists().catch(() => undefined);
        await flushMicrotasks(3);
        pendingProjectGet[1].reject(new Error('get failed'));
        pendingSessionsList[1].resolve([
          {id: 's3', title: 'S3', updatedAtMs: 3},
        ]);
        await flushMicrotasks();
      });
      expect(scope.api().currentProject).toBeUndefined();
      expect(scope.api().sessions).toEqual([
        {id: 's3', title: 'S3', updatedAtMs: 3},
      ]);

      // listByProject 失败轮：reloadLists 向外抛、meta 已落、sessions 不覆盖。
      let caught: unknown;
      await act(async () => {
        const reloading = scope
          .api()
          .reloadLists()
          .catch(error => {
            caught = error;
          });
        await flushMicrotasks(3);
        pendingProjectGet[2].resolve({id: 'p1', name: 'P1'});
        pendingSessionsList[2].reject(new Error('list failed'));
        await reloading;
        await flushMicrotasks();
      });
      expect((caught as Error).message).toBe('list failed');
      // get 的结果已先行落位（原语义：meta 更新不因 sessions 失败回滚）。
      expect(scope.api().currentProject).toEqual({id: 'p1', name: 'P1'});
      expect(scope.api().sessions).toEqual([
        {id: 's3', title: 'S3', updatedAtMs: 3},
      ]);
    });
  });

  describe('refreshChatMeta', () => {
    it('getCurrentModelId 与 loadChatAgentMeta 并行发起（发起时间交叠），落位结果与串行版等价', async () => {
      const {runtime, pendingModelId} = buildRuntime();
      const scope = await mountScopeHarness(runtime, {
        projectId: 'p1',
        sessionId: 's1',
      });

      // 挂载触发的 refreshChatMeta：两路均已发起且挂起——getCurrentModelId
      // 未完成时 loadChatAgentMeta 已发起，串行版必须等它完成才会发起后者。
      expect(runtime.state.getCurrentModelId).toHaveBeenCalledTimes(1);
      expect(loadChatAgentMetaMock).toHaveBeenCalledTimes(1);
      expect(pendingModelId).toHaveLength(1);
      expect(pendingMeta).toHaveLength(1);

      await act(async () => {
        pendingModelId[0].resolve('openai/gpt-4o-mini');
        pendingMeta[0].resolve(MOCK_META);
        await flushMicrotasks();
      });

      const api = scope.api();
      expect(api.hasWorkspaceModel).toBe(true);
      expect(api.agentMeta.source).toBe('session');
      expect(api.agentMeta.agentName).toBe('Agent');
      expect(api.agentMeta.modelLabel).toBe('Model');
      // 成功链尾随的 token 标签刷新（mock 立即返回 ''）。
      expect(api.agentMeta.tokenLabel).toBe('');
    });

    it('在途重入合并为一轮（首屏三触发去重）；落定后新调用新起一轮', async () => {
      const {runtime, pendingModelId} = buildRuntime();
      const scope = await mountScopeHarness(runtime, {
        projectId: 'p1',
        sessionId: 's1',
      });
      // 挂载已发起第一轮（双双挂起中）。
      expect(loadChatAgentMetaMock).toHaveBeenCalledTimes(1);

      // 模拟首屏三处触发在同一挂载周期内重入：在途时连调两次。
      await act(async () => {
        void scope.api().refreshChatMeta().catch(() => undefined);
        void scope.api().refreshChatMeta().catch(() => undefined);
        await flushMicrotasks();
      });
      // 同参在途复用：与挂载那次合并，仍只有一轮查询。
      expect(loadChatAgentMetaMock).toHaveBeenCalledTimes(1);
      expect(runtime.state.getCurrentModelId).toHaveBeenCalledTimes(1);

      // 放行第一轮，状态落位（modelId 为空 → 无工作区模型）。
      await act(async () => {
        pendingModelId[0].resolve('');
        pendingMeta[0].resolve(MOCK_META);
        await flushMicrotasks();
      });
      expect(scope.api().hasWorkspaceModel).toBe(false);
      expect(scope.api().agentMeta.agentName).toBe('Agent');

      // 落定后无 inflight：再次调用（如重新聚焦）正常新起一轮。
      await act(async () => {
        const refreshing = scope.api().refreshChatMeta();
        await flushMicrotasks(3);
        expect(loadChatAgentMetaMock).toHaveBeenCalledTimes(2);
        pendingModelId[1].resolve('openai/gpt-4o-mini');
        pendingMeta[1].resolve(MOCK_META);
        await refreshing;
        await flushMicrotasks();
      });
      expect(scope.api().hasWorkspaceModel).toBe(true);
    });

    it('参数变化不复用旧 inflight：切换会话后新会话的刷新立即发起', async () => {
      const {runtime, pendingModelId} = buildRuntime();
      const scope = await mountScopeHarness(runtime, {
        projectId: 'p1',
        sessionId: 's1',
      });
      // s1 轮挂起中。
      expect(loadChatAgentMetaMock).toHaveBeenCalledTimes(1);
      expect(loadChatAgentMetaMock.mock.calls[0][2]).toBe('s1');

      // 切到 s2：key 变化，不复用 s1 的在途 promise，立即发起 s2 轮。
      await scope.update({sessionId: 's2'});
      expect(loadChatAgentMetaMock).toHaveBeenCalledTimes(2);
      expect(loadChatAgentMetaMock.mock.calls[1][2]).toBe('s2');

      // 两轮各自放行，最终态由 s2 轮落位。
      await act(async () => {
        pendingModelId[0].resolve('');
        pendingModelId[1].resolve('openai/gpt-4o-mini');
        pendingMeta[0].resolve(MOCK_META);
        pendingMeta[1].resolve({...MOCK_META, agentName: 'Agent-2'});
        await flushMicrotasks();
      });
      expect(scope.api().agentMeta.agentName).toBe('Agent-2');
    });
  });
});
