import React from 'react';
import {describe, expect, it, jest} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Alert} from 'react-native';

jest.mock('@/errors/format-error', () => ({
  formatError: (err: unknown) => String(err),
}));

jest.mock('@novel-master/core', () => ({
  EVENT_AGENT_RUN_FINISHED: 'agent.run.finished',
  EVENT_AGENT_STREAM_TEXT_DELTA: 'agent.stream.text',
  EVENT_AGENT_STREAM_THINKING_DELTA: 'agent.stream.thinking',
  VfsError: class VfsError extends Error {},
  VfsZipError: class VfsZipError extends Error {},
  TdbcError: class TdbcError extends Error {},
  KkvError: class KkvError extends Error {},
  ProviderError: class ProviderError extends Error {},
  ChatError: class ChatError extends Error {},
  ToolError: class ToolError extends Error {},
  AgentError: class AgentError extends Error {},
}));

jest.mock('@novel-master/core/chat', () => {
  const actual = jest.requireActual(
    '@novel-master/core/chat',
  ) as typeof import('@novel-master/core/chat');
  return {
    ...actual,
  };
});

jest.mock('@/components/chat/FileReferencePicker', () => ({
  FileReferencePicker: () => null,
}));

jest.mock('@/components/skills/SkillPicker', () => ({
  SkillPicker: () => null,
}));

jest.mock('@/components/chat/AttachmentDraftChips', () => {
  const actual = jest.requireActual(
    '@/components/chat/AttachmentDraftChips',
  ) as typeof import('@/components/chat/AttachmentDraftChips');
  return {
    ...actual,
    AttachmentDraftChips: () => null,
    ComposerStatusChips: () => null,
  };
});

(global as any).__DEV__ = false;

jest.mock('@/runtime/novel-master-context', () => ({
  useNovelMaster: () => ({appUi: null}),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

const mockGetLlmStreamEnabled = jest.fn(async () => true);
const mockGetComposerDraftJson = jest.fn(
  async (): Promise<string | null> => null,
);
const mockProjectComposerStatus = jest.fn(async () => [] as unknown[]);
jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => ({
    eventBus: {
      subscribe: () => ({unsubscribe: () => undefined}),
    },
    preferences: {
      getLlmStreamEnabled: mockGetLlmStreamEnabled,
    },
    userVfsTurn: {},
    sessions: {
      getComposerDraftJson: (...args: unknown[]) =>
        mockGetComposerDraftJson(...args),
      setComposerDraftJson: async () => true,
      get: async () => ({projectId: 'p'}),
    },
    workplace: () => ({}),
  }),
}));

jest.mock('@/services/project-composer-status.service', () => ({
  projectComposerStatusForSession: (...args: unknown[]) =>
    mockProjectComposerStatus(...args),
}));

const mockRunAgentTurn = jest.fn(
  async (_runtime, _scope, _content, options) => {
    return new Promise<void>((resolve, reject) => {
      const signal: AbortSignal | undefined = options?.signal;
      if (signal?.aborted) {
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      signal?.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        {once: true},
      );
    });
  },
);

jest.mock('@/services/agent-run.service', () => ({
  runAgentTurn: (...args: any[]) => mockRunAgentTurn(...args),
}));

import {serializeComposerDraftJson} from '@novel-master/core/chat';
import {ChatComposer} from '@/components/chat/ChatComposer';
import {useAgentRunLifecycle} from '@/hooks/useAgentRunLifecycle';
import {useSessionAbort} from '@/screens/tabs/chat-tab/useSessionAbort';
import {
  decrementAgentActive,
  isMobileAgentActive,
  setMobileAgentActive,
} from '@/runtime/agent-activity';
import {ThemeProvider} from '@/theme/ThemeProvider';
import {
  clearChatComposerDraft,
  writeChatComposerDraft,
} from '@/storage/chat-composer-draft';
import {
  addChatAnnotateDraft,
  resetChatAnnotateDraftStoreForTests,
} from '@/storage/chat-annotate-draft';

function Harness(props: {
  canResumeWithoutInput: boolean;
  lastMessageIsPlainUserText?: boolean;
  draftRestoreToken?: number;
}) {
  // 与 ChatTabProvider 等价的 abort + lifecycle 装配（composer 是 dumb component）。
  const onStreamResetRef = React.useRef<() => void>(() => undefined);
  const abortRegistry = React.useRef({
    register: () => undefined,
    abort: () => undefined,
    unregister: () => undefined,
    has: () => false,
  });
  const abort = useSessionAbort({
    sessionId: 's',
    abortRegistry: abortRegistry.current as never,
    onStreamResetRef,
  });
  const lifecycle = useAgentRunLifecycle({
    onRunUiActivate: abort.markRunStarted,
    onRunUiDeactivate: abort.markRunEnded,
    getUiRunning: abort.getUiRunning,
  });
  return (
    <ThemeProvider>
      <ChatComposer
        scope={{projectId: 'p', sessionId: 's'}}
        hasModel={true}
        running={abort.uiRunning}
        beginUiRun={lifecycle.beginUiRun}
        endUiRunOnError={lifecycle.endUiRunOnError}
        abortUiRun={abort.abortUiRun}
        onStreamReset={() => undefined}
        onMessagesChanged={() => undefined}
        onNeedModel={() => undefined}
        canResumeWithoutInput={props.canResumeWithoutInput}
        lastMessageIsPlainUserText={props.lastMessageIsPlainUserText ?? false}
        draftRestoreToken={props.draftRestoreToken}
      />
    </ThemeProvider>
  );
}

describe('ChatComposer integration', () => {
  beforeEach(() => {
    setMobileAgentActive(false);
    mockRunAgentTurn.mockClear();
    mockGetComposerDraftJson.mockReset();
    mockGetComposerDraftJson.mockResolvedValue(null);
    mockProjectComposerStatus.mockReset();
    mockProjectComposerStatus.mockResolvedValue([]);
    clearChatComposerDraft('s');
    resetChatAnnotateDraftStoreForTests();
  });
  it('running-state “终止” action aborts current run', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={true} />);
    });
    const sendBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '发送',
    );

    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(1);

    // Second press while running should abort.
    const stopBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '终止',
    );
    await act(async () => {
      stopBtn.props.onPress();
    });

    // runAgentTurn stays at 1 call; cancellation is via AbortSignal.
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(1);
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });

  it('empty input + resumable session keeps send enabled', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={true} />);
    });
    const sendBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    expect(sendBtn.props.disabled).toBe(false);
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });

  it('empty input + non-resumable session disables send', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={false} />);
    });
    const sendBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    expect(sendBtn.props.disabled).toBe(true);
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });

  it('T22: agentActive 时第二次发送被拒绝', async () => {
    setMobileAgentActive(true);
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={true} />);
    });
    const sendBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(mockRunAgentTurn).not.toHaveBeenCalled();
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });

  it('T23: run 早退时 agentActive 回落', async () => {
    mockRunAgentTurn.mockRejectedValueOnce(new Error('early fail'));
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={true} />);
    });
    const sendBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(isMobileAgentActive()).toBe(false);
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });

  it('draftRestoreToken 变更时从 draft 刷新输入', async () => {
    mockGetComposerDraftJson.mockResolvedValue(
      serializeComposerDraftJson({
        text: 'restored text',
        attachments: [],
      }),
    );
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <Harness canResumeWithoutInput={false} draftRestoreToken={0} />,
      );
    });
    const input = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.testID === 'chat-composer-input',
    );
    expect(input.props.value).toBe('restored text');

    mockGetComposerDraftJson.mockResolvedValue(
      serializeComposerDraftJson({
        text: 'after rollback',
        attachments: [],
      }),
    );
    writeChatComposerDraft('s', 'after rollback');
    await act(async () => {
      tree!.update(
        <Harness canResumeWithoutInput={false} draftRestoreToken={1} />,
      );
    });
    expect(input.props.value).toBe('after rollback');
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });

  it('T-PM5: 末条 user 含 tool_result 时输入直发、不弹窗、不调桥', async () => {
    // A4 后 composer 不再感知 tool_result 状态：旧「插入桥接消息」确认弹窗与
    // appendToolTurnBridge 已移除，用户输入一律直接走 runAgentTurn（PRD 验收 1）。
    const alertSpy = jest.spyOn(Alert, 'alert');
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={false} />);
    });
    const input = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.testID === 'chat-composer-input',
    );
    await act(async () => {
      input.props.onChangeText('after tool result');
    });
    const sendBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(1);
    expect(mockRunAgentTurn.mock.calls[0]?.[2]).toBe('after tool result');
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });

  it('T23: RUN_FINISHED 已递减时 finally 不再双减', async () => {
    mockRunAgentTurn.mockImplementationOnce(async () => {
      // 模拟 useChatStreamRuntime 在 runAgentTurn 结束前已处理 FINISHED
      decrementAgentActive();
    });
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={true} />);
    });
    const sendBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(isMobileAgentActive()).toBe(false);
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });

  it('T-CR3: 仅状态条 workplace → 不可发（禁空发）', async () => {
    mockRunAgentTurn.mockImplementationOnce(async () => undefined);
    // 历史 draft attach 水化时丢弃；文件引用只认正文 @
    mockGetComposerDraftJson.mockResolvedValue(
      serializeComposerDraftJson({
        text: '',
        attachments: [
          {
            name: '/a.md',
            source: 'attach',
            type: 'text',
            content: null,
            path: '/a.md',
          },
        ],
      }),
    );
    mockProjectComposerStatus.mockResolvedValue([
      {
        name: '/w.md',
        source: 'workplace',
        type: 'text',
        content: null,
        path: '/w.md',
      },
    ]);
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={false} />);
    });
    const sendBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    expect(sendBtn.props.disabled).toBe(true);
    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(mockRunAgentTurn).not.toHaveBeenCalled();
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });

  it('T-CR3: 仅 workplace + canResume → 走 resume 门闩而非差集可发', async () => {
    mockRunAgentTurn.mockImplementationOnce(async () => undefined);
    mockProjectComposerStatus.mockResolvedValue([
      {
        name: '/w.md',
        source: 'workplace',
        type: 'text',
        content: null,
        path: '/w.md',
      },
    ]);
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={true} />);
    });
    const sendBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    // 无可发输入时 canResume 仍可点（纯 resume），但非 workplace 差集门闩
    expect(sendBtn.props.disabled).toBe(false);
    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(1);
    const opts = mockRunAgentTurn.mock.calls[0]?.[3] as {
      allowResumeWithoutInput?: boolean;
      attachments?: unknown;
    };
    expect(opts.allowResumeWithoutInput).toBe(true);
    expect(opts.attachments).toBeUndefined();
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });

  it('T-UO3 镜像: 无正文 + 仅 annotate 草稿时发送键可点，且 runAgentTurn 收到 annotateDrafts', async () => {
    // 前置：无正文、无批注、不可 resume → 不可发
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={false} />);
    });
    const sendBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    expect(sendBtn.props.disabled).toBe(true);

    // 仅加 annotate 草稿（无正文）→ 门闩放行，非 resume 通道
    // store 订阅 listener 会同步 setState，须包 act 避免警告
    await act(async () => {
      addChatAnnotateDraft('s', {
        id: 'anno-1',
        path: '/a.md',
        originalText: 'hello',
        userAnnotation: 'note',
        renderStart: 0,
        renderEnd: 5,
      });
    });
    await act(async () => {
      tree!.update(<Harness canResumeWithoutInput={false} />);
    });
    expect(sendBtn.props.disabled).toBe(false);

    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(1);
    const opts = mockRunAgentTurn.mock.calls[0]?.[3] as {
      allowResumeWithoutInput?: boolean;
      annotateDrafts?: unknown[];
    };
    expect(opts.allowResumeWithoutInput).toBe(false);
    expect(opts.annotateDrafts).toEqual([
      {
        id: 'anno-1',
        path: '/a.md',
        originalText: 'hello',
        userAnnotation: 'note',
        renderStart: 0,
        renderEnd: 5,
      },
    ]);
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });
});
