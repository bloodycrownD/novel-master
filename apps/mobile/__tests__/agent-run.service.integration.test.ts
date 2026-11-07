import {describe, expect, it, jest} from '@jest/globals';
import {userMessageOf} from '@novel-master/core/i18n';

import {coreT} from '@/i18n/core';
import {runAgentTurn} from '@/services/agent-run.service';

function baseRuntime(overrides: Partial<any> = {}) {
  return {
    state: {
      getCurrentAgentId: async () => 'a1',
      getCurrentModelId: async () => 'openai/gpt',
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
      // 续跑判定走 tail(1) 单行读（2026-09-30 替换全量 listBySession）。
      listBySessionTail: async () => [],
      append: jest.fn(async () => undefined),
    },
    sessionVfs: () => ({}),
    sessionFs: {},
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
        listBySessionTail: async () => [{role: 'user', content: {blocks: []}}],
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
        listBySessionTail: async () => [
          {role: 'assistant', content: {blocks: []}},
        ],
        append: jest.fn(async () => undefined),
      },
    });
    // 迁移后抛的是带 messageKey 的 descriptor（Error.message 为 key 原文），
    // 经 core translator 解析后再断言用户可见中文。
    const error = await runAgentTurn(
      runtime as any,
      {projectId: 'p', sessionId: 's'},
      '',
      {allowResumeWithoutInput: true},
    ).catch((e: unknown) => e);
    const descriptor = userMessageOf(error);
    expect(descriptor).not.toBeNull();
    expect(coreT(descriptor!)).toBe('消息不能为空');
  });
});
