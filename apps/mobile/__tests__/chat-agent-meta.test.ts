import {describe, expect, it, jest} from '@jest/globals';
import {buildDefaultAgentDefinitionPreservingName} from '@novel-master/core/config-forms/stored-config-validity';
import {PROJECT_AGENT_META_DISPLAY_LABEL} from '@novel-master/core/chat';
import {loadChatAgentMeta} from '../src/services/chat-agent-meta';

const globalDefinition = buildDefaultAgentDefinitionPreservingName('全局助手');
const projectDefinition = buildDefaultAgentDefinitionPreservingName('项目副本');

function mockRuntime(overrides: {
  agentConfig?: {mode: 'follow' | 'custom'; definition?: typeof projectDefinition};
  currentAgentId?: string;
  currentModelId?: string;
}) {
  const {
    agentConfig = {mode: 'follow'},
    currentAgentId = 'default',
    currentModelId = 'openai:gpt-4',
  } = overrides;
  return {
    state: {
      getCurrentAgentId: jest.fn(async () => currentAgentId),
      getCurrentModelId: jest.fn(async () => currentModelId),
    },
    agentRegistry: {
      listAgentIds: jest.fn(async () => [currentAgentId]),
      get: jest.fn(async () => globalDefinition),
    },
    projects: {
      getAgentConfig: jest.fn(async () => agentConfig),
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
  it('follow 模式展示全局 Agent 名称', async () => {
    const meta = await loadChatAgentMeta(
      mockRuntime({agentConfig: {mode: 'follow'}}) as never,
      'proj-1',
    );
    expect(meta.source).toBe('global');
    expect(meta.agentName).toBe('全局助手');
    expect(meta.agentId).toBe('default');
  });

  it('custom 模式固定展示项目智能体文案', async () => {
    const meta = await loadChatAgentMeta(
      mockRuntime({
        agentConfig: {mode: 'custom', definition: projectDefinition},
      }) as never,
      'proj-1',
    );
    expect(meta.source).toBe('project-custom');
    expect(meta.agentId).toBeUndefined();
    expect(meta.agentName).toBe(PROJECT_AGENT_META_DISPLAY_LABEL);
    expect(meta.agentName).toBe('项目智能体');
  });
});
