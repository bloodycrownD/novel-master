import {describe, expect, it, jest} from '@jest/globals';
import {
  loadSessionAgentPickerRows,
  selectSessionAgent,
} from '../src/services/agent-picker';

// core 移除 workspace 回退层后，SessionAgentConfig = { agentId, modelId? }。
function mockRuntime(sessionAgentConfig: {agentId: string; modelId?: string}) {
  return {
    state: {
      getCurrentAgentId: jest.fn(async () => 'workspace-agent'),
    },
    agentRegistry: {
      listAgentIds: jest.fn(async () => ['agent-a', 'workspace-agent']),
      get: jest.fn(async (id: string) => ({
        name: `显示名-${id}`,
      })),
    },
    sessions: {
      getSessionAgentConfig: jest.fn(async () => sessionAgentConfig),
      updateSessionAgentConfig: jest.fn(async () => sessionAgentConfig),
    },
  };
}

describe('session 级 agent picker', () => {
  it('loadSessionAgentPickerRows：currentId 直接取会话 agentId', async () => {
    const rt = mockRuntime({agentId: 'agent-a'});
    const result = await loadSessionAgentPickerRows(rt as never, 'sess-1');
    expect(result.currentId).toBe('agent-a');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      agentId: 'agent-a',
      label: '显示名-agent-a',
    });
    expect(rt.sessions.getSessionAgentConfig).toHaveBeenCalledWith('sess-1');
  });

  it('selectSessionAgent：写会话 agentId，不动 workspace 全局指针', async () => {
    const rt = mockRuntime({agentId: 'agent-b'});
    await selectSessionAgent(rt as never, 'sess-1', 'agent-a');
    expect(rt.sessions.updateSessionAgentConfig).toHaveBeenCalledWith('sess-1', {
      agentId: 'agent-a',
    });
    // 不该碰 workspace 全局 state
    expect(rt.state.getCurrentAgentId).not.toHaveBeenCalled();
  });
});
