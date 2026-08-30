/**
 * T-CA5（mobile 侧）：预览口径 parity —— buildSessionPromptInput（预览路径）
 * 在 definition 带 customAttach 时，产出的 messages 里含 <extra-info> 块。
 *
 * 预览路径（buildSessionPromptInput）与真实路径（agent-runner）最终都经
 * prepareUserMessagesForPrompt → wrapUserMessageForLlm，所以只要断言预览路径
 * 注入了 extra-info 块，就能守住「UI 预览与发给模型的提示词在 extra-info 段上一致」。
 *
 * 这里用最小 runtime stub 走真实 buildSessionPromptInput：workplace layout 不开 →
 * assembleWorkplaceDisplay 短路；user 消息无附件 → prepare 内不触 vfs/sessionKkv；
 * regexConfig 无 active group → applyActiveRegexChannel 原样返回。
 */
import {describe, expect, it, jest} from '@jest/globals';
import {textBlocks} from '@novel-master/core/chat';
import {buildDefaultAgentDefinitionPreservingName} from '@novel-master/core/config-forms/stored-config-validity';

import {buildSessionPromptInput} from '@/services/session-prompt-input.service';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

// regex-apply-channel 依赖的 @novel-master/core/regex 在 mobile jest 配置里没有映射，
// 且本用例只关心 customAttach 在 prepare 路径的 parity，不需要真实 regex 逻辑，
// 直接 mock 成原样透传可见消息即可。
jest.mock('@/services/regex-apply-channel', () => ({
  applyActiveRegexChannel: jest.fn(
    async (
      _config: unknown,
      _groupId: unknown,
      _all: unknown,
      visible: readonly never[],
    ) => [...visible],
  ),
}));

/** 从消息 content（{ blocks: [...] }）里拼出纯文本，供断言关键字。 */
function bodyText(content: unknown): string {
  if (
    content == null ||
    typeof content !== 'object' ||
    !Array.isArray((content as {blocks?: unknown}).blocks)
  ) {
    return '';
  }
  return (content as {blocks: unknown[]}).blocks
    .map(block =>
      block != null &&
      typeof block === 'object' &&
      (block as {type?: string}).type === 'text'
        ? String((block as {text?: unknown}).text ?? '')
        : '',
    )
    .join('\n');
}

function makeStubRuntime(): MobileNovelMasterRuntime {
  return {
    messages: {
      listBySession: jest.fn(async () => [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'user',
          content: textBlocks('你好，请记住附加信息'),
          attachments: [],
          hidden: false,
        },
      ]),
    },
    state: {
      getCurrentRegexGroupId: jest.fn(async () => undefined),
    },
    regexConfig: {},
    workplace: jest.fn(() => ({})),
    sessionVfs: jest.fn(() => ({})),
    // skillAttach hydrate 用的技能服务工厂；本用例消息无 skillAttach 附件，
    // prepare 惰性预算不会真正调用，给个空壳即可。
    skills: jest.fn(() => ({})),
    sessionKkv: {
      get: jest.fn(async () => null),
      set: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
      clearSession: jest.fn(async () => undefined),
      listKeys: jest.fn(async () => []),
    },
  } as unknown as MobileNovelMasterRuntime;
}

describe('buildSessionPromptInput (T-CA5 mobile)', () => {
  it('definition.prompts.customAttach 非空时预览路径 messages 含 <extra-info> 块', async () => {
    const runtime = makeStubRuntime();
    const definition =
      buildDefaultAgentDefinitionPreservingName('extra-info-agent');
    // 与 domain prompts.customAttach 对齐；wrap 阶段在 </user-ops> 后注入 <extra-info>。
    definition.prompts = {
      ...definition.prompts,
      customAttach: '这是常驻附加信息：优先级最高',
    };

    const bundle = await buildSessionPromptInput(
      runtime,
      {projectId: 'p1', sessionId: 's1'},
      definition,
    );

    const userBody = bundle.ctx.messages
      .filter(m => m.role === 'user')
      .map(m => bodyText(m.content))
      .join('\n');

    expect(userBody).toMatch(/<extra-info>/);
    expect(userBody).toMatch(/这是常驻附加信息：优先级最高/);
  });
});
