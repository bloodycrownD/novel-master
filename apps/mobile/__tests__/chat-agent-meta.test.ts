import {describe, expect, it, jest} from '@jest/globals';
import {buildDefaultAgentDefinitionPreservingName} from '@novel-master/core/config-forms/stored-config-validity';
import {loadChatAgentMeta} from '@/services/chat-agent-meta';

const globalDefinition = buildDefaultAgentDefinitionPreservingName('全局助手');
const sessionAgentDefinition =
  buildDefaultAgentDefinitionPreservingName('会话引用助手');

// core 移除 workspace 回退层后，SessionAgentConfig = { agentId, modelId? }。
const DEFAULT_SESSION_CONFIG = {agentId: 'default'};

function mockRuntime(overrides: {
  agentConfig?: {
    mode: 'follow' | 'custom';
    definition?: typeof projectDefinition;
  };
  currentAgentId?: string;
  currentModelId?: string;
  sessionAgentConfig?: {agentId: string; modelId?: string};
  sessionAgentDefinition?: typeof globalDefinition;
}) {
  const {
    agentConfig = {mode: 'follow'},
    currentAgentId = 'default',
    currentModelId = 'openai:gpt-4',
    sessionAgentConfig = DEFAULT_SESSION_CONFIG,
    sessionAgentDefinition = sessionAgentDefinition,
  } = overrides;
  return {
    state: {
      getCurrentAgentId: jest.fn(async () => currentAgentId),
      getCurrentModelId: jest.fn(async () => currentModelId),
    },
    agentRegistry: {
      listAgentIds: jest.fn(async () => [currentAgentId]),
      // core 解析链用 sessionConfig.agentId 直接取 registry，这里统一兜底。
      get: jest.fn(async (id: string) => {
        if (id === 'session-agent-x') {
          return sessionAgentDefinition;
        }
        return globalDefinition;
      }),
    },
    projects: {
      getAgentConfig: jest.fn(async () => agentConfig),
    },
    sessions: {
      getSessionAgentConfig: jest.fn(async () => sessionAgentConfig),
      updateSessionAgentConfig: jest.fn(async () => sessionAgentConfig),
    },
    providerModels: {
      resolveDisplayLabel: jest.fn(async () => 'GPT-4'),
    },
  };
}

jest.mock('@/services/model-display-label', () => ({
  resolveModelDisplayLabel: jest.fn(async () => 'GPT-4'),
}));

describe('loadChatAgentMeta', () => {
  it('project follow + session.agentId → session，展示会话引用 Agent 名称', async () => {
    const meta = await loadChatAgentMeta(
      mockRuntime({
        agentConfig: {mode: 'follow'},
        sessionAgentConfig: {agentId: 'default'},
      }) as never,
      'proj-1',
      'sess-1',
    );
    expect(meta.source).toBe('session');
    expect(meta.agentName).toBe('全局助手');
    expect(meta.agentId).toBe('default');
    // 无 agent pin、session 未带 modelId → session（默认跟随会话）
    expect(meta.modelSource).toBe('session');
  });

  it('modelSource=agent-pin：agent definition 自带 model 压制一切', async () => {
    const pinned = buildDefaultAgentDefinitionPreservingName('带 pin 助手');
    pinned.model = 'openai:pinned-model';
    const meta = await loadChatAgentMeta(
      mockRuntime({
        agentConfig: {mode: 'follow'},
        currentAgentId: 'pinned-agent',
        sessionAgentDefinition: pinned,
        // 即便 session 带 modelId，agent pin 仍优先
        sessionAgentConfig: {
          agentId: 'session-agent-x',
          modelId: 'openai:session-override',
        },
      }) as never,
      'proj-1',
      'sess-1',
    );
    expect(meta.hasDedicatedModel).toBe(true);
    expect(meta.modelSource).toBe('agent-pin');
  });

  it('T-C1：resolveAgentForProject 与 getSessionAgentConfig 并行发起，输出与串行版等价', async () => {
    // 受控 getSessionAgentConfig：挂起时不 resolve。resolveAgentForProject
    // 内部第一步就是它——挂起即 resolveAgentForProject 不可能完成；
    // 此时若外层那次 getSessionAgentConfig 也已发起（共 2 次调用），
    // 即证明两路并行（串行版会等 resolveAgentForProject 完成后才发起
    // 外层调用，此刻只会是 1 次）。
    let resolveConfig!: (value: {agentId: string; modelId?: string}) => void;
    const configPromise = new Promise<{agentId: string; modelId?: string}>(
      resolve => {
        resolveConfig = resolve;
      },
    );
    const runtime: any = mockRuntime({
      sessionAgentConfig: {agentId: 'default', modelId: 'openai:gpt-4'},
    });
    runtime.sessions.getSessionAgentConfig = jest.fn(() => configPromise);

    const metaPromise = loadChatAgentMeta(runtime, 'proj-1', 'sess-1');
    // flush microtask：让两路查询都推进到挂起的 await。
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.sessions.getSessionAgentConfig).toHaveBeenCalledTimes(2);

    // 放行后输出与串行版一致：session 来源、agent 名称、savedModelId
    // （session.modelId 兜底）→ 模型标签、modelSource 跟随会话。
    resolveConfig({agentId: 'default', modelId: 'openai:gpt-4'});
    const meta = await metaPromise;
    expect(meta).toEqual({
      source: 'session',
      agentId: 'default',
      agentName: '全局助手',
      modelLabel: 'GPT-4',
      tokenLabel: '',
      hasDedicatedModel: false,
      modelSource: 'session',
    });
  });
});
