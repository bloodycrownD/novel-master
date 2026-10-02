/**
 * T-FEPar-4：openFileEditor(session) 必须在 navigate **之前**写入保存回调。
 *
 * 病灶（N-P1-03）：回调原先挂在路由 params 上（不可序列化），且 8 个 navigate
 * 调用点一处都没传 ⇒ 恒 no-op。修法把它改成模块级单例，写入时序就成了新的
 * 正确性依赖：navigate 触发挂载、挂载时 take——晚一步就取到 null。
 *
 * 观测面：在 navigate 的 mock 内当场 take 一次并记录取到的值 ⇒
 * 「navigate 被调用前回调已在位」这件事被直接锁住，不依赖 UI 文案。
 */
import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {useChatTabScope} from '@/screens/tabs/chat-tab/useChatTabScope';
import {takeFileEditorOnSessionVfsSaved} from '@/components/agent/file-editor-saved-callback';

jest.mock('@/services/chat-agent-meta', () => ({
  loadChatAgentMeta: jest.fn(async () => ({
    source: 'session',
    agentId: 'a1',
    agentName: 'Agent',
    modelLabel: 'Model',
    tokenLabel: '',
    hasDedicatedModel: false,
    modelSource: 'session',
  })),
}));

jest.mock('@/services/chat-prompt-tokens.service', () => ({
  loadChatPromptTokenLabelResilient: jest.fn(async () => ''),
  isChatTokenPreciseWarmInflight: jest.fn(() => false),
  // 防御性补键（tokenizer-native-cancel）：hook 的换 key 分支 / 卸载 cleanup
  // 也会调 cancelPreciseUpgrade，缺键即 undefined 抛。
  cancelPreciseUpgrade: jest.fn(),
  // Part D 新导出（cr2-E-2 同族，换 key 分支首轮必调）。
  cancelPreciseUpgradeDelay: jest.fn(),
}));

const mockRuntime: any = {
  projects: {
    list: jest.fn(async () => [{id: 'p1', name: 'P1'}]),
    get: jest.fn(async () => ({id: 'p1', name: 'P1'})),
    delete: jest.fn(),
  },
  sessions: {
    listByProject: jest.fn(async () => []),
    delete: jest.fn(),
  },
  state: {getCurrentModelId: jest.fn(async () => 'openai/gpt-4o-mini')},
  sessionVfs: jest.fn(() => ({})),
  workplace: jest.fn(() => ({})),
  projectVfs: jest.fn(() => ({})),
  sessionStreamUnitManager: {forgetSession: jest.fn()},
};

describe('openFileEditor 保存回调接线（N-P1-03）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    takeFileEditorOnSessionVfsSaved();
  });

  it('T-FEPar-4 session scope：navigate 被调用前回调已写入', async () => {
    let cbAtNavigateTime: unknown = 'navigate-not-called';
    const navigation = {
      navigate: jest.fn(() => {
        cbAtNavigateTime = takeFileEditorOnSessionVfsSaved();
      }),
    } as never;

    let api: ReturnType<typeof useChatTabScope> | undefined;
    function Harness() {
      api = useChatTabScope({
        runtime: mockRuntime,
        projectId: 'p1',
        sessionId: 's1',
        setCurrentProject: jest.fn(async () => undefined),
        setCurrentSession: jest.fn(async () => undefined),
        refreshScope: jest.fn(async () => undefined),
        showToast: jest.fn(),
        navigation,
      });
      return null;
    }
    await act(async () => {
      TestRenderer.create(React.createElement(Harness));
    });

    await act(async () => {
      api!.openFileEditor('/sessions/s1/a.md', 'session');
    });

    expect(navigation.navigate).toHaveBeenCalledWith('FileEditor', {
      path: '/sessions/s1/a.md',
      scopeKind: 'session',
      projectId: 'p1',
      sessionId: 's1',
    });
    expect(typeof cbAtNavigateTime).toBe('function');
  });

  it('T-FEPar-4 project scope：不需要保存回调（只覆盖 session 域刷新）', async () => {
    const navigation = {navigate: jest.fn()} as never;
    let api: ReturnType<typeof useChatTabScope> | undefined;
    function Harness() {
      api = useChatTabScope({
        runtime: mockRuntime,
        projectId: 'p1',
        sessionId: 's1',
        setCurrentProject: jest.fn(async () => undefined),
        setCurrentSession: jest.fn(async () => undefined),
        refreshScope: jest.fn(async () => undefined),
        showToast: jest.fn(),
        navigation,
      });
      return null;
    }
    await act(async () => {
      TestRenderer.create(React.createElement(Harness));
    });

    await act(async () => {
      api!.openFileEditor('/projects/p1/tpl/a.md', 'project');
    });

    expect(navigation.navigate).toHaveBeenCalledWith('FileEditor', {
      path: '/projects/p1/tpl/a.md',
      scopeKind: 'project',
      projectId: 'p1',
    });
    // project 域不写回调：避免上一次 session 打开的回调被误消费
    expect(takeFileEditorOnSessionVfsSaved()).toBeNull();
  });
});
