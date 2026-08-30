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
});
