import {describe, expect, it, jest} from '@jest/globals';

jest.mock('@novel-master/core', () => ({
  AgentConfigError: class AgentConfigError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'AgentConfigError';
      this.code = code;
    }
  },
  ChatAgentSession: class ChatAgentSession {},
  createAgentRunner: () => ({
    run: jest.fn(async () => ({stopReason: 'completed'})),
  }),
  registerVfsTools: () => undefined,
  resolveAgentToolRegistry: (_probe: any, _def: any) => ({}),
  resolveApplicationModelId: () => 'openai/gpt',
  textBlocks: (t: string) => ({blocks: [{type: 'text', text: t}]}),
  ToolRegistry: class ToolRegistry {
    list() {
      return [];
    }
  },
  validateAgentDefinition: async () => undefined,
}));

import {runAgentTurn} from '../src/services/agent-run.service';

function baseRuntime(overrides: Partial<any> = {}) {
  return {
    state: {
      getCurrentAgentId: async () => 'a1',
      getCurrentModelId: async () => 'openai/gpt',
      getCurrentRegexGroupId: async () => undefined,
    },
    agentRegistry: {
      listAgentIds: async () => ['a1'],
      get: async () => ({name: 'x', prompts: [{name: 'c', type: 'chat'}]}),
    },
    messages: {
      listBySession: async () => [],
      append: jest.fn(async () => undefined),
    },
    sessionVfs: () => ({}),
    sessionFs: {},
    regexConfig: {},
    eventBus: {subscribe: () => ({unsubscribe: () => undefined})},
    macroCache: {refresh: async () => undefined},
    worktree: () => ({
      renderDisplay: async () => '',
      renderFileTree: async () => '',
    }),
    modelRequests: {},
    compactionConditionEvaluator: undefined,
    eventOrchestrator: {},
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
    await runAgentTurn(
      runtime as any,
      {projectId: 'p', sessionId: 's'},
      '',
      {allowResumeWithoutInput: true},
    );
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
      runAgentTurn(
        runtime as any,
        {projectId: 'p', sessionId: 's'},
        '',
        {allowResumeWithoutInput: true},
      ),
    ).rejects.toThrow('消息不能为空');
  });
});

