import {describe, expect, it, jest} from '@jest/globals';
import {
  loadSessionAgentPickerRows,
  selectSessionAgent,
  clearSessionAgentBinding,
} from '../src/services/agent-picker';

function mockRuntime(sessionAgentConfig: {mode: 'follow'} | {mode: 'bind'; agentId: string; modelId?: string}) {
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
  it('loadSessionAgentPickerRows：session bind 时 currentId 取会话绑定 agent', async () => {
    const rt = mockRuntime({mode: 'bind', agentId: 'agent-a'});
    const result = await loadSessionAgentPickerRows(rt as never, 'sess-1');
    expect(result.currentId).toBe('agent-a');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      agentId: 'agent-a',
      label: '显示名-agent-a',
    });
    // bind 时 currentId 取会话绑定，不回退 workspace 结果
    expect(result.currentId).toBe('agent-a');
    expect(rt.sessions.getSessionAgentConfig).toHaveBeenCalledWith('sess-1');
  });

  it('loadSessionAgentPickerRows：session follow 时 currentId 回退 workspace', async () => {
    const rt = mockRuntime({mode: 'follow'});
    const result = await loadSessionAgentPickerRows(rt as never, 'sess-1');
    expect(result.currentId).toBe('workspace-agent');
    expect(rt.state.getCurrentAgentId).toHaveBeenCalled();
  });

  it('selectSessionAgent：写 session bind，不动 workspace 全局指针', async () => {
    const rt = mockRuntime({mode: 'follow'});
    await selectSessionAgent(rt as never, 'sess-1', 'agent-a');
    expect(rt.sessions.updateSessionAgentConfig).toHaveBeenCalledWith(
      'sess-1',
      {mode: 'bind', agentId: 'agent-a'},
    );
    // 不该碰 workspace 全局 state
    expect(rt.state.getCurrentAgentId).not.toHaveBeenCalled();
  });

  it('clearSessionAgentBinding：写 follow（解绑）', async () => {
    const rt = mockRuntime({mode: 'bind', agentId: 'agent-a'});
    await clearSessionAgentBinding(rt as never, 'sess-1');
    expect(rt.sessions.updateSessionAgentConfig).toHaveBeenCalledWith(
      'sess-1',
      {mode: 'follow'},
    );
  });
});
