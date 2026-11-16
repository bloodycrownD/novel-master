import {describe, expect, it, jest} from '@jest/globals';
import {
  loadSessionAgentPickerRows,
  selectSessionAgent,
} from '@/services/agent-picker';

// core 移除 workspace 回退层后，SessionAgentConfig = { agentId, modelId? }。
function mockRuntime(sessionAgentConfig: {agentId: string; modelId?: string}) {
  return {
    state: {
      getCurrentAgentId: jest.fn(async () => 'workspace-agent'),
    },
    agentRegistry: {
      listAgentIds: jest.fn(async () => ['agent-a', 'workspace-agent']),
      // 错误通道迁移后 registry.get 走 Result 通道（生产侧 `def.ok` 判定）。
      get: jest.fn(async (id: string) => ({
        ok: true as const,
        value: {name: `显示名-${id}`},
      })),
    },
    sessions: {
      // 错误通道迁移后 getSessionAgentConfig 走 Result 通道（生产侧 `!ok` 即 throw）。
      getSessionAgentConfig: jest.fn(async () => ({
        ok: true as const,
        value: sessionAgentConfig,
      })),
      updateSessionAgentConfig: jest.fn(async () => sessionAgentConfig),
    },
  };
}

describe('session 级 agent picker', () => {
  it('loadSessionAgentPickerRows：currentId 直接取会话 agentId', async () => {
    const rt = mockRuntime({agentId: 'agent-a'});
    const loaded = await loadSessionAgentPickerRows(rt as never, 'sess-1');
    if (!loaded.ok) throw loaded.error;
    const result = loaded.value;
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
    expect(rt.sessions.updateSessionAgentConfig).toHaveBeenCalledWith(
      'sess-1',
      {
        agentId: 'agent-a',
      },
    );
    // 不该碰 workspace 全局 state
    expect(rt.state.getCurrentAgentId).not.toHaveBeenCalled();
  });
});
