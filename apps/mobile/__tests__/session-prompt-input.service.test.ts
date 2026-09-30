/**
 * T-CA5（mobile 侧）：预览口径 parity —— buildSessionPromptInput（预览路径）
 * 在 definition 带 customAttach 时，产出的 messages 里含 <extra-info> 块。
 *
 * 预览路径（buildSessionPromptInput）与真实路径（agent-runner）最终都经
 * prepareUserMessagesForPrompt → wrapUserMessageForLlm，所以只要断言预览路径
 * 注入了 extra-info 块，就能守住「UI 预览与发给模型的提示词在 extra-info 段上一致」。
 *
 * r3-chip-1 / r3-test-1 ④：build 段分段弃权检查点（shouldBail 命中即抛
 * ChatPromptBuildBailedError，后续段不得执行）。这两组用例都**不整体 mock**
 * buildSessionPromptInput——真跑本文件的分段逻辑，只 mock 最底层 IO
 * （messages.listBySession / sessionVkv / vfs），段与段的边界用各段内部依赖
 * 的调用与否钉住。
 *
 * 这里用最小 runtime stub 走真实 buildSessionPromptInput：workplace layout 不开 →
 * assembleWorkplaceDisplay 短路；user 消息无附件 → prepare 内不触 vfs/sessionKkv。
 */
import {describe, expect, it, jest} from '@jest/globals';
import {textBlocks} from '@novel-master/core/chat';
import {buildDefaultAgentDefinitionPreservingName} from '@novel-master/core/config-forms/stored-config-validity';

import {
  buildSessionPromptInput,
  ChatPromptBuildBailedError,
} from '@/services/session-prompt-input.service';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

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
    state: {},
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

describe('buildSessionPromptInput 分段弃权检查点（r3-test-1 ④）', () => {
  /** 段序（与实现一一对应）：resolve agent → messages → workplace → prepare。 */
  const buildWithBailAt = async (bailAtCall: number) => {
    const runtime = makeStubRuntime();
    const definition = buildDefaultAgentDefinitionPreservingName('bail-agent');
    let calls = 0;
    const observed = {
      listBySession: () => (runtime.messages.listBySession as jest.Mock).mock.calls.length,
      workplace: () => (runtime.workplace as jest.Mock).mock.calls.length,
      sessionVfs: () => (runtime.sessionVfs as jest.Mock).mock.calls.length,
      skills: () => (runtime.skills as jest.Mock).mock.calls.length,
    };
    const shouldBail = () => {
      calls += 1;
      return calls === bailAtCall;
    };
    const promise = buildSessionPromptInput(
      runtime,
      {projectId: 'p1', sessionId: 's1'},
      definition,
      {shouldBail},
    );
    return {promise, observed, bailCalls: () => calls};
  };

  it('弃权开关恒假：build 走完全程，四道检查点各问一次', async () => {
    const runtime = makeStubRuntime();
    const definition = buildDefaultAgentDefinitionPreservingName('no-bail-agent');
    const shouldBail = jest.fn(() => false);
    const bundle = await buildSessionPromptInput(
      runtime,
      {projectId: 'p1', sessionId: 's1'},
      definition,
      {shouldBail},
    );
    expect(bundle.input).toBeDefined();
    expect(shouldBail).toHaveBeenCalledTimes(4);
  });

  it('第 1 段翻真（agent 解析后）：抛 ChatPromptBuildBailedError，消息段未执行', async () => {
    const {promise, observed} = await buildWithBailAt(1);
    await expect(promise).rejects.toBeInstanceOf(ChatPromptBuildBailedError);
    expect(observed.listBySession()).toBe(0);
  });

  it('第 2 段翻真（消息拉取后）：抛错，workplace 段未执行', async () => {
    const {promise, observed} = await buildWithBailAt(2);
    await expect(promise).rejects.toBeInstanceOf(ChatPromptBuildBailedError);
    expect(observed.listBySession()).toBe(1);
    expect(observed.workplace()).toBe(0);
    expect(observed.skills()).toBe(0);
  });

  it('第 3 段翻真（workplace 组装后）：抛错，prepare 段未执行', async () => {
    const {promise, observed} = await buildWithBailAt(3);
    await expect(promise).rejects.toBeInstanceOf(ChatPromptBuildBailedError);
    expect(observed.workplace()).toBe(1);
    expect(observed.sessionVfs()).toBe(1);
    // prepare 的入参（含 skills()）整段未求值
    expect(observed.skills()).toBe(0);
  });

  it('第 4 段翻真（prepare 后）：抛错，layout 组装段未执行', async () => {
    const {promise, observed, bailCalls} = await buildWithBailAt(4);
    await expect(promise).rejects.toBeInstanceOf(ChatPromptBuildBailedError);
    expect(observed.skills()).toBe(1);
    // 只问了 4 次：第 4 次之后没有 layout 段的检查点，也没有落库式副作用
    expect(bailCalls()).toBe(4);
  });

  it('不传 shouldBail：行为不变（预览等非 chip 消费方不受弃权影响）', async () => {
    const runtime = makeStubRuntime();
    const definition = buildDefaultAgentDefinitionPreservingName('plain-agent');
    const bundle = await buildSessionPromptInput(
      runtime,
      {projectId: 'p1', sessionId: 's1'},
      definition,
    );
    expect(bundle.rawMessages).toHaveLength(1);
    expect(bundle.input).toBeDefined();
  });
});
