/**
 * mobile build 的 workplace 段内中止转换（2026-09-30「停止要等 14 秒」治本）：
 * core 的 assembleWorkplaceDisplay 在文件粒度检查点抛
 * WorkplaceAssemblyAbortedError 后，build 必须把它转抛成统一的
 * ChatPromptBuildBailedError（读口 catch 的判定不变），且 shouldBail 判据要
 * 真正透传进 assemble（run 起步后组装在第一个文件边界就死）；fingerprint
 * 必须流进 ctx（估算记忆的键原料）。
 *
 * 组装行为本身（检查点位置/粒度）由 core 的
 * assemble-abort-fingerprint.test.ts 锁定，这里只钉「接线与转换」。
 */
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import {textBlocks} from '@novel-master/core/chat';
import {
  buildDefaultAgentDefinitionPreservingName,
} from '@novel-master/core/config-forms/stored-config-validity';
import {WorkplaceAssemblyAbortedError} from '@novel-master/core/workplace';

const mockAssemble = jest.fn();

jest.mock('@novel-master/core/workplace', () => {
  // 真模块整体保留（WorkplaceAssemblyAbortedError 必须是同一个类，被测服务
  // 的 instanceof 才成立），只把 assembleWorkplaceDisplay 换成可控桩。
  const actual = jest.requireActual('@novel-master/core/workplace');
  return {
    ...actual,
    assembleWorkplaceDisplay: (...args: unknown[]) => mockAssemble(...args),
  };
});

import {
  buildSessionPromptInput,
  ChatPromptBuildBailedError,
} from '@/services/session-prompt-input.service';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

function makeStubRuntime(): MobileNovelMasterRuntime {
  return {
    messages: {
      listBySession: jest.fn(async () => [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'user',
          content: textBlocks('你好'),
          attachments: [],
          hidden: false,
        },
      ]),
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
  const definition = buildDefaultAgentDefinitionPreservingName('wp-agent');
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

  it('assemble 抛 WorkplaceAssemblyAbortedError → build 转抛 ChatPromptBuildBailedError', async () => {
    mockAssemble.mockImplementation(async () => {
      throw new WorkplaceAssemblyAbortedError();
    });
    await expect(
      buildSessionPromptInput(
        makeStubRuntime(),
        {projectId: 'p', sessionId: 's'},
        workplaceDefinition(),
        {shouldBail: () => false},
      ),
    ).rejects.toBeInstanceOf(ChatPromptBuildBailedError);
  });

  it('shouldBail 判据透传进 assemble 的 shouldStop（run 起步即死在文件边界）', async () => {
    mockAssemble.mockResolvedValue({
      workplaceDisplay: 'x',
      prefixPaths: [],
      fingerprint: 'fp-1',
    });
    let stopRequested = false;
    await buildSessionPromptInput(
      makeStubRuntime(),
      {projectId: 'p', sessionId: 's'},
      workplaceDefinition(),
      {shouldBail: () => stopRequested},
    );
    const options = mockAssemble.mock.calls[0]?.[2] as
      | {shouldStop?: () => boolean}
      | undefined;
    expect(options?.shouldStop).toBeInstanceOf(Function);
    expect(options?.shouldStop?.()).toBe(false);
    stopRequested = true;
    expect(options?.shouldStop?.()).toBe(true, 'shouldStop 必须实时反映 shouldBail');
  });

  it('assemble 产出的 fingerprint 流进 ctx（估算记忆的键原料）', async () => {
    mockAssemble.mockResolvedValue({
      workplaceDisplay: '前缀',
      prefixPaths: [],
      fingerprint: 'fp-abc',
    });
    const bundle = await buildSessionPromptInput(
      makeStubRuntime(),
      {projectId: 'p', sessionId: 's'},
      workplaceDefinition(),
    );
    expect(bundle.ctx.workplaceFingerprint).toBe('fp-abc');
  });
});
