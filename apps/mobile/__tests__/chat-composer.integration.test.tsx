import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../src/errors/format-error', () => ({
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

jest.mock('../src/components/chat/FileReferencePicker', () => ({
  FileReferencePicker: () => null,
}));

jest.mock('../src/components/chat/AttachmentDraftChips', () => {
  const actual = jest.requireActual(
    '../src/components/chat/AttachmentDraftChips',
  ) as typeof import('../src/components/chat/AttachmentDraftChips');
  return {
    ...actual,
    AttachmentDraftChips: () => null,
    ComposerStatusChips: () => null,
    ComposerAttachChips: () => null,
  };
});

(global as any).__DEV__ = false;

jest.mock('../src/runtime/novel-master-context', () => ({
  useNovelMaster: () => ({ appUi: null }),
}));

const mockGetLlmStreamEnabled = jest.fn(async () => true);
const mockHasPendingTurns = jest.fn(async () => false);
const mockGetComposerDraftJson = jest.fn(
  async (): Promise<string | null> => null,
);
const mockProjectComposerStatus = jest.fn(async () => [] as unknown[]);
jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => ({
    eventBus: {
      subscribe: () => ({ unsubscribe: () => undefined }),
    },
    preferences: {
      getLlmStreamEnabled: mockGetLlmStreamEnabled,
    },
    userVfsTurn: {
      hasPendingTurns: (...args: unknown[]) => mockHasPendingTurns(...args),
    },
    sessions: {
      getComposerDraftJson: (...args: unknown[]) =>
        mockGetComposerDraftJson(...args),
      setComposerDraftJson: async () => true,
      get: async () => ({ projectId: 'p' }),
    },
    worktree: () => ({}),
    appendToolTurnBridge: async () => undefined,
  }),
}));

jest.mock('../src/services/project-composer-status.service', () => ({
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
        { once: true },
      );
    });
  },
);

jest.mock('../src/services/agent-run.service', () => ({
  runAgentTurn: (...args: any[]) => mockRunAgentTurn(...args),
}));

import { serializeComposerDraftJson } from '@novel-master/core/chat';
import { ChatComposer } from '../src/components/chat/ChatComposer';
import { useAgentRunLifecycle } from '../src/hooks/useAgentRunLifecycle';
import {
  decrementAgentActive,
  isMobileAgentActive,
  setMobileAgentActive,
} from '../src/runtime/agent-activity';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import {
  clearChatComposerDraft,
  writeChatComposerDraft,
} from '../src/storage/chat-composer-draft';

function Harness(props: {
  canResumeWithoutInput: boolean;
  lastMessageHasToolResult?: boolean;
  lastMessageIsPlainUserText?: boolean;
  draftRestoreToken?: number;
}) {
  const lifecycle = useAgentRunLifecycle();
  return (
    <ThemeProvider>
      <ChatComposer
        scope={{ projectId: 'p', sessionId: 's' }}
        hasModel={true}
        running={lifecycle.uiRunning}
        beginUiRun={lifecycle.beginUiRun}
        abortUiRun={lifecycle.abortUiRun}
        onStreamReset={() => undefined}
        onMessagesChanged={() => undefined}
        onNeedModel={() => undefined}
        canResumeWithoutInput={props.canResumeWithoutInput}
        lastMessageHasToolResult={props.lastMessageHasToolResult ?? false}
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
    mockHasPendingTurns.mockReset();
    mockHasPendingTurns.mockResolvedValue(false);
    mockGetComposerDraftJson.mockReset();
    mockGetComposerDraftJson.mockResolvedValue(null);
    mockProjectComposerStatus.mockReset();
    mockProjectComposerStatus.mockResolvedValue([]);
    clearChatComposerDraft('s');
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

  it('T-SR1b: 仅状态条 workplace 可发且禁纯 resume；入参无预览 chip', async () => {
    mockRunAgentTurn.mockImplementationOnce(async () => undefined);
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
      tree = TestRenderer.create(<Harness canResumeWithoutInput={true} />);
    });
    const sendBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    expect(sendBtn.props.disabled).toBe(false);
    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(1);
    const opts = mockRunAgentTurn.mock.calls[0]?.[3] as {
      allowResumeWithoutInput?: boolean;
      attachments?: readonly { source: string }[];
    };
    expect(opts.allowResumeWithoutInput).toBe(false);
    expect(opts.attachments?.every(a => a.source === 'attach')).toBe(true);
    expect(opts.attachments).toHaveLength(1);
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });

  it('T-SR1b: 仅 workplace 空发可点（非 resume）', async () => {
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
      tree = TestRenderer.create(<Harness canResumeWithoutInput={false} />);
    });
    const sendBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    expect(sendBtn.props.disabled).toBe(false);
    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(1);
    const opts = mockRunAgentTurn.mock.calls[0]?.[3] as {
      allowResumeWithoutInput?: boolean;
      attachments?: unknown;
    };
    expect(opts.allowResumeWithoutInput).toBe(false);
    expect(opts.attachments).toBeUndefined();
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });
});
