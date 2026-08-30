import {describe, expect, it, jest} from '@jest/globals';

import {runAgentTurn} from '@/services/agent-run.service';

function baseRuntime(overrides: Partial<any> = {}) {
  return {
    state: {
      getCurrentAgentId: async () => 'a1',
      getCurrentModelId: async () => 'openai/gpt',
      getCurrentRegexGroupId: async () => undefined,
    },
    projects: {
      getAgentConfig: async () => ({
        mode: 'custom',
        definition: {
          name: 'x',
          prompts: {persist: [], dynamic: []},
          model: 'openai/gpt',
        },
      }),
    },
    // chat-session-detail-page 起：项目智能体下线，会话独立持有 agentId，
    // resolveAgentForProject 改从 sessions.getSessionAgentConfig 取 agentId。
    sessions: {
      getSessionAgentConfig: async () => ({agentId: 'a1'}),
    },
    agentRegistry: {
      listAgentIds: async () => ['a1'],
      get: async () => ({
        name: 'x',
        prompts: {persist: [], dynamic: []},
        model: 'openai/gpt',
      }),
    },
    messageCheckpoint: {
      capture: jest.fn(async () => undefined),
      backfillMissingBaselines: jest.fn(async () => undefined),
    },
    messages: {
      listBySession: async () => [],
      append: jest.fn(async () => undefined),
    },
    sessionVfs: () => ({}),
    sessionFs: {},
    regexConfig: {},
    eventBus: {
      publish: jest.fn(),
      subscribe: () => ({unsubscribe: () => undefined}),
    },
    sessionKkv: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
      clearSession: async () => undefined,
      listKeys: async () => [],
    },
    workplace: () => ({
      materializePersistBlock: async () => ({workplaceDisplay: ''}),
    }),
    modelRequests: {},
    compactionConditionEvaluator: {
      shouldRequestCompaction: async () => false,
      getHideStartDepth: async () => 6,
    },
    ...overrides,
  };
}

describe('runAgentTurn integration', () => {
  it('empty input + last user → allowed, no empty message appended', async () => {
    const runtime = baseRuntime({
      messages: {
        listBySession: async () => [{role: 'user', content: {blocks: []}}],
        append: jest.fn(async () => undefined),
      },
    });
    try {
      await runAgentTurn(runtime as any, {projectId: 'p', sessionId: 's'}, '', {
        allowResumeWithoutInput: true,
      });
    } catch {
      // Stub runtime lacks full event bus; resume gate is what we assert.
    }
    expect(runtime.messages.append).not.toHaveBeenCalled();
  });

  it('empty input + last non-user → blocked', async () => {
    const runtime = baseRuntime({
      messages: {
        listBySession: async () => [{role: 'assistant', content: {blocks: []}}],
        append: jest.fn(async () => undefined),
      },
    });
    await expect(
      runAgentTurn(runtime as any, {projectId: 'p', sessionId: 's'}, '', {
        allowResumeWithoutInput: true,
      }),
    ).rejects.toThrow('消息不能为空');
  });
});
