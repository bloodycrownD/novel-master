import {describe, expect, it, jest} from '@jest/globals';
import {buildDefaultAgentDefinitionPreservingName} from '@novel-master/core/config-forms/stored-config-validity';
import {PROJECT_AGENT_META_DISPLAY_LABEL} from '@novel-master/core/chat';
import {loadChatAgentMeta} from '../src/services/chat-agent-meta';

const globalDefinition = buildDefaultAgentDefinitionPreservingName('全局助手');
const projectDefinition = buildDefaultAgentDefinitionPreservingName('项目副本');
const sessionBindDefinition = buildDefaultAgentDefinitionPreservingName('会话绑定助手');

const DEFAULT_SESSION_CONFIG = {mode: 'follow'};

function mockRuntime(overrides: {
  agentConfig?: {mode: 'follow' | 'custom'; definition?: typeof projectDefinition};
  currentAgentId?: string;
  currentModelId?: string;
  sessionAgentConfig?: {mode: 'follow'} | {mode: 'bind'; agentId: string; modelId?: string};
  sessionBindAgentDefinition?: typeof globalDefinition;
}) {
  const {
    agentConfig = {mode: 'follow'},
    currentAgentId = 'default',
    currentModelId = 'openai:gpt-4',
    sessionAgentConfig = DEFAULT_SESSION_CONFIG,
    sessionBindAgentDefinition = sessionBindDefinition,
  } = overrides;
  return {
    state: {
      getCurrentAgentId: jest.fn(async () => currentAgentId),
      getCurrentModelId: jest.fn(async () => currentModelId),
    },
    agentRegistry: {
      listAgentIds: jest.fn(async () => [currentAgentId]),
      // follow 时回退取全局；session-bind 时 core 会用 sessionConfig.agentId 来取，这里统一兜底。
      get: jest.fn(async (id: string) => {
        if (id === 'session-bind-agent') {
          return sessionBindAgentDefinition;
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

jest.mock('../src/provider/model-display-label', () => ({
  resolveModelDisplayLabel: jest.fn(async () => 'GPT-4'),
}));

describe('loadChatAgentMeta', () => {
  it('project follow + session follow → global，展示全局 Agent 名称', async () => {
    const meta = await loadChatAgentMeta(
      mockRuntime({agentConfig: {mode: 'follow'}}) as never,
      'proj-1',
      'sess-1',
    );
    expect(meta.source).toBe('global');
    expect(meta.agentName).toBe('全局助手');
    expect(meta.agentId).toBe('default');
    // 无 agent pin、session 未 override → workspace
    expect(meta.modelSource).toBe('workspace');
  });

  it('project follow + session bind → session-bind，返回会话绑定 agent', async () => {
    const meta = await loadChatAgentMeta(
      mockRuntime({
        agentConfig: {mode: 'follow'},
        sessionAgentConfig: {mode: 'bind', agentId: 'session-bind-agent'},
      }) as never,
      'proj-1',
      'sess-1',
    );
    expect(meta.source).toBe('session-bind');
    expect(meta.agentId).toBe('session-bind-agent');
    expect(meta.agentName).toBe('会话绑定助手');
    // session bind 但未带 modelId → workspace
    expect(meta.modelSource).toBe('workspace');
  });

  it('project custom 截断 session 绑定，source 为 project-custom 且不暴露 session', async () => {
    const meta = await loadChatAgentMeta(
      mockRuntime({
        agentConfig: {mode: 'custom', definition: projectDefinition},
        // 即使 session 配了 bind，custom 截断后也不该走 session-bind
        sessionAgentConfig: {mode: 'bind', agentId: 'session-bind-agent'},
      }) as never,
      'proj-1',
      'sess-1',
    );
    expect(meta.source).toBe('project-custom');
    expect(meta.agentId).toBeUndefined();
    expect(meta.agentName).toBe(PROJECT_AGENT_META_DISPLAY_LABEL);
    expect(meta.agentName).toBe('项目智能体');
    // custom 路径不读 session，hasDedicatedModel 由 projectDefinition.model 决定（默认空）→ workspace
    expect(meta.modelSource).toBe('workspace');
  });

  it('modelSource=agent-pin：agent definition 自带 model 压制一切', async () => {
    const pinned = buildDefaultAgentDefinitionPreservingName('带 pin 助手');
    pinned.model = 'openai:pinned-model';
    const meta = await loadChatAgentMeta(
      mockRuntime({
        agentConfig: {mode: 'follow'},
        currentAgentId: 'pinned-agent',
        sessionBindAgentDefinition: pinned,
        // 即便 session bind + modelId，agent pin 仍优先
        sessionAgentConfig: {
          mode: 'bind',
          agentId: 'session-bind-agent',
          modelId: 'openai:session-override',
        },
      }) as never,
      'proj-1',
      'sess-1',
    );
    expect(meta.hasDedicatedModel).toBe(true);
    expect(meta.modelSource).toBe('agent-pin');
  });

  it('modelSource=session-override：session bind + modelId 且 agent 无 pin', async () => {
    const meta = await loadChatAgentMeta(
      mockRuntime({
        agentConfig: {mode: 'follow'},
        sessionAgentConfig: {
          mode: 'bind',
          agentId: 'session-bind-agent',
          modelId: 'openai:session-override',
        },
      }) as never,
      'proj-1',
      'sess-1',
    );
    expect(meta.source).toBe('session-bind');
    expect(meta.hasDedicatedModel).toBe(false);
    expect(meta.modelSource).toBe('session-override');
  });
});
