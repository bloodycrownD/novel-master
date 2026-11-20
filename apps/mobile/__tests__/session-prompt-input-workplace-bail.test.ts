/**
 * mobile build 的 workplace 段内中止转换（2026-09-30「停止要等 14 秒」治本）：
 * core 的 WorkplaceDisplayAssembler.assemble 在文件粒度检查点中止（错误通道迁移二期起
 * 沿 Outcome.cancelled/replaced 返回，不再抛 WorkplaceAssemblyAbortedError），
 * build 把它转抛成统一的 ChatPromptBuildBailedError（读口 catch 的判定不变），
 * 且 shouldBail 判据要真正透传进 assemble（run 起步后组装在第一个文件边界
 * 就死）；fingerprint 必须流进 ctx（估算记忆的键原料）。
 *
 * 组装行为本身（检查点位置/粒度）由 core 的
 * assemble-abort-fingerprint.test.ts 锁定，这里只钉「接线与转换」。
 */
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import {TextBlocks} from '@novel-master/core/chat';
import {DefaultAgentDefinition} from '@novel-master/core/stored-config-validity';

const mockAssemble = jest.fn();

jest.mock('@novel-master/core/workplace', () => {
  // 真模块整体保留，只把 WorkplaceDisplayAssembler.assemble 换成可控桩。
  const actual = jest.requireActual('@novel-master/core/workplace');
  return {
    ...actual,
    WorkplaceDisplayAssembler: {
      ...actual.WorkplaceDisplayAssembler,
      assemble: (...args: unknown[]) => mockAssemble(...args),
    },
  };
});

import {ChatPromptBuildBailedError} from '@novel-master/core';
import {SessionPromptInputService} from '@/services/session-prompt-input.service'
import type {MobileNovelMasterRuntime} from '@/runtime/types';

function makeStubRuntime(): MobileNovelMasterRuntime {
  return {
    messages: {
      listBySession: jest.fn(async () => ({
        kind: 'completed' as const,
        value: [
          {
            id: 'm1',
            sessionId: 's1',
            role: 'user',
            content: TextBlocks.of('你好'),
            attachments: [],
            hidden: false,
          },
        ],
      })),
    },
    state: {},
    workplace: jest.fn(() => ({})),
    sessionVfs: jest.fn(() => ({})),
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

function workplaceDefinition() {
  const definition = DefaultAgentDefinition.build('wp-agent');
  definition.prompts = {
    ...definition.prompts,
    persist: [],
    dynamic: [],
    workplace: '【工作区】',
  };
  return definition;
}

describe('workplace 段内中止的接线与转换（2026-09-30 治本）', () => {
  beforeEach(() => {
    mockAssemble.mockReset();
  });

  it('assemble 弃权（Outcome cancelled/replaced）→ build 转抛 ChatPromptBuildBailedError', async () => {
    // 错误通道迁移二期：core assemble 不再抛 WorkplaceAssemblyAbortedError，
    // 中止沿 Outcome.cancelled/replaced 返回，由 build 转抛统一哨兵。
    mockAssemble.mockResolvedValue({kind: 'replaced'});
    await expect(
      SessionPromptInputService.build(
        makeStubRuntime(),
        {projectId: 'p', sessionId: 's'},
        workplaceDefinition(),
        {shouldBail: () => false},
      ),
    ).rejects.toBeInstanceOf(ChatPromptBuildBailedError);
  });

  it('shouldBail 判据透传进 assemble 的 checkpoint（run 起步即死在文件边界）', async () => {
    mockAssemble.mockResolvedValue({
      kind: 'completed',
      value: {
        workplaceDisplay: 'x',
        prefixPaths: [],
        visiblePaths: [],
        fingerprint: 'fp-1',
      },
    });
    let stopRequested = false;
    await SessionPromptInputService.build(
      makeStubRuntime(),
      {projectId: 'p', sessionId: 's'},
      workplaceDefinition(),
      {shouldBail: () => stopRequested},
    );
    const options = mockAssemble.mock.calls[0]?.[2] as
      | {checkpoint?: () => unknown}
      | undefined;
    expect(options?.checkpoint).toBeInstanceOf(Function);
    // 二期后判据返回 Interrupt：未命中 null、命中 {kind:'replaced'}。
    expect(options?.checkpoint?.()).toBeNull();
    stopRequested = true;
    expect(options?.checkpoint?.()).toEqual(
      {kind: 'replaced'},
      'checkpoint 必须实时反映 shouldBail',
    );
  });

  it('assemble 产出的 fingerprint 流进 ctx（估算记忆的键原料）', async () => {
    mockAssemble.mockResolvedValue({
      kind: 'completed',
      value: {
        workplaceDisplay: '前缀',
        prefixPaths: [],
        visiblePaths: [],
        fingerprint: 'fp-abc',
      },
    });
    const bundleResult = await SessionPromptInputService.build(
      makeStubRuntime(),
      {projectId: 'p', sessionId: 's'},
      workplaceDefinition(),
    )
    if (!bundleResult.ok) throw bundleResult.error;
    const bundle = bundleResult.value;;
    expect(bundle.ctx.workplaceFingerprint).toBe('fp-abc');
  });
});
