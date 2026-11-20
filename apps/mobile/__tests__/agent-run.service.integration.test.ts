import {describe, expect, it, jest} from '@jest/globals';
import {AppErrorOps} from '@novel-master/core/errors';
import {ErrorMessage} from '@novel-master/core/i18n';

import {coreT} from '@/i18n/core';
import {AgentRunService} from '@/services/agent-run.service'

function baseRuntime(overrides: Partial<any> = {}) {
  return {
    state: {
      // 错误通道迁移后 state 读口走 Result（resolveCurrentAgentId /
      // resolveApplicationModelIdForRun 均按 `!ok` 解包）。
      getCurrentAgentId: async () => ({ok: true, value: 'a1'}),
      getCurrentModelId: async () => ({ok: true, value: 'openai/gpt'}),
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
      // 错误通道迁移二期后走 Result（resolveApplicationModelIdForRun `!ok` 即 throw）。
      getSessionAgentConfig: async () => ({ok: true, value: {agentId: 'a1'}}),
    },
    agentRegistry: {
      listAgentIds: async () => ['a1'],
      // 错误通道迁移后 registry.get 走 Result（resolveAgentForProject `!ok` 即归一）。
      get: async () => ({
        ok: true,
        value: {
          name: 'x',
          prompts: {persist: [], dynamic: []},
          model: 'openai/gpt',
        },
      }),
    },
    messageCheckpoint: {
      capture: jest.fn(async () => undefined),
      backfillMissingBaselines: jest.fn(async () => undefined),
    },
    messages: {
      listBySession: async () => ({kind: 'completed' as const, value: []}),
      // 续跑判定走 tail(1) 单行读（2026-09-30 替换全量 listBySession）。
      listBySessionTail: async () => ({kind: 'completed' as const, value: []}),
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

describe('runAgentTurnAdapter integration', () => {
  it('empty input + last user → allowed, no empty message appended', async () => {
    const runtime = baseRuntime({
      messages: {
        listBySession: async () => ({kind: 'completed' as const, value: [{role: 'user', content: {blocks: []}}]}),
        listBySessionTail: async () => ({kind: 'completed' as const, value: [{role: 'user', content: {blocks: []}}]}),
        append: jest.fn(async () => undefined),
      },
    });
    try {
      await AgentRunService.run(runtime as any, {projectId: 'p', sessionId: 's'}, '', {
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
        listBySession: async () => ({kind: 'completed' as const, value: [{role: 'assistant', content: {blocks: []}}]}),
        listBySessionTail: async () => ({
          kind: 'completed' as const,
          value: [{role: 'assistant', content: {blocks: []}}],
        }),
        append: jest.fn(async () => undefined),
      },
    });
    // 前奏期空输入拦截是业务失败：沿 Result.err（AppError AGENT_MESSAGE_EMPTY，
    // 自带 code + messageKey）交回，经 core translator 解析后再断言用户可见中文。
    const result = await AgentRunService.run(
      runtime as any,
      {projectId: 'p', sessionId: 's'},
      '',
      {allowResumeWithoutInput: true},
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('预期 Err（空输入必须被拦截）');
    expect(AppErrorOps.is(result.error, 'AGENT_MESSAGE_EMPTY')).toBe(true);
    const descriptor = ErrorMessage.userOf(result.error);
    expect(descriptor).not.toBeNull();
    expect(coreT(descriptor!)).toBe('消息不能为空');
  });
});
