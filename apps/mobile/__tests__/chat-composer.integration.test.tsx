import React from 'react';
import {describe, expect, it, jest} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Alert, TextInput} from 'react-native';

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

// T-CR4：捕获 onConfirm 供集成用例驱动「选择器 → replaceCommittedText」程序化写入路径。
const mockFilePickerProps: {
  onConfirm?: (pathTokens: readonly string[]) => void;
} = {};
jest.mock('../src/components/chat/FileReferencePicker', () => ({
  FileReferencePicker: (props: {
    onConfirm: (pathTokens: readonly string[]) => void;
  }) => {
    mockFilePickerProps.onConfirm = props.onConfirm;
    return null;
  },
}));

jest.mock('../src/components/skills/SkillPicker', () => ({
  SkillPicker: () => null,
}));

jest.mock('../src/components/chat/AttachmentDraftChips', () => {
  const actual = jest.requireActual(
    '../src/components/chat/AttachmentDraftChips',
  ) as typeof import('../src/components/chat/AttachmentDraftChips');
  return {
    ...actual,
    AttachmentDraftChips: () => null,
    ComposerStatusChips: () => null,
  };
});

(global as any).__DEV__ = false;

jest.mock('../src/runtime/novel-master-context', () => ({
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
// 可变 runtime 容器：Harness 每次挂载时重填（含 agentRunManager）。
const mockRuntime: Record<string, unknown> = {};
jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
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
        {once: true},
      );
    });
  },
);

jest.mock('../src/services/agent-run.service', () => ({
  runAgentTurn: (...args: any[]) => mockRunAgentTurn(...args),
}));

import {SimpleEventBus} from '@novel-master/core/events';
import {serializeComposerDraftJson} from '@novel-master/core/chat';
import {ChatComposer} from '../src/components/chat/ChatComposer';
import {ComposerAtPathInput} from '../src/components/chat/ComposerAtPathInput';
import {
  formatAtPathMentionMarkup,
  mentionValueToPlain,
} from '../src/components/chat/composer-at-path-mention';
import {SessionStreamUnitManager} from '../src/services/session-stream-unit-manager.service';
import {
  isMobileAgentActive,
  setMobileAgentActive,
} from '../src/runtime/agent-activity';
import {ThemeProvider} from '../src/theme/ThemeProvider';
import {
  clearChatComposerDraft,
  readChatComposerDraftState,
  writeChatComposerDraft,
} from '../src/storage/chat-composer-draft';
import {
  addChatAnnotateDraft,
  listChatAnnotateDrafts,
  resetChatAnnotateDraftStoreForTests,
} from '@novel-master/core/chat';

/** 当前 Harness 的 eventBus（测试里 publish run 生命周期事件用）。 */
let harnessEventBus: SimpleEventBus | undefined;
/** 当前 Harness 的 Manager。 */
let harnessManager: SessionStreamUnitManager | undefined;

function Harness(props: {
  canResumeWithoutInput: boolean;
  lastMessageIsPlainUserText?: boolean;
  draftRestoreToken?: number;
  onMessagesChanged?: () => void | Promise<void>;
}) {
  // Step 6 平移：真 SessionStreamUnitManager 装配（与 Provider bootstrap 同
  // 形状）+ mock runtime（eventBus / abortRegistry / sessions），
  // runAgentTurn 注入 mock。composer 是 dumb component——running 从 manager
  // 投影派生（与 ChatConversationPanel 同语义：status 为 starting|running）。
  const abortRegistry = React.useRef({
    register: () => undefined,
    abort: () => undefined,
    unregister: () => undefined,
    has: () => false,
  });
  const eventBus = React.useRef(new SimpleEventBus()).current;
  const managerRef = React.useRef<SessionStreamUnitManager>();
  if (managerRef.current == null) {
    managerRef.current = new SessionStreamUnitManager({
      runtime: {
        eventBus,
        abortRegistry: abortRegistry.current,
        sessions: {get: async () => ({id: 's', title: '会话 s'})},
      } as never,
      runAgentTurn: mockRunAgentTurn as never,
    });
    // harness 无持久层：显式放行水合（snapshot 可读）。
    managerRef.current.markHydrated();
  }
  const manager = managerRef.current;
  const [running, setRunning] = React.useState(
    () =>
      manager.snapshot('s')?.status === 'starting' ||
      manager.snapshot('s')?.status === 'running',
  );
  React.useEffect(() => {
    const sync = () => {
      const status = manager.snapshot('s')?.status;
      setRunning(status === 'starting' || status === 'running');
    };
    sync();
    return manager.subscribe(sync);
  }, [manager]);
  harnessEventBus = eventBus;
  harnessManager = manager;
  Object.assign(mockRuntime, {
    eventBus,
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
    sessionStreamUnitManager: manager,
  });
  return (
    <ThemeProvider>
      <ChatComposer
        scope={{projectId: 'p', sessionId: 's'}}
        hasModel={true}
        running={running}
        onMessagesChanged={props.onMessagesChanged ?? (() => undefined)}
        onNeedModel={() => undefined}
        canResumeWithoutInput={props.canResumeWithoutInput}
        lastMessageIsPlainUserText={props.lastMessageIsPlainUserText ?? false}
        draftRestoreToken={props.draftRestoreToken}
      />
    </ThemeProvider>
  );
}

/**
 * 定位 ComposerAtPathInput 内部的原生 TextInput（mention 库的 handleChangeText
 * 挂在该节点上）。注意：按 testID 直接 find 会命中外层 ComposerAtPathInput
 * 组件自身的 props（同名 testID），绕过 mention 层，故先按类型再按 testID 过滤。
 */
function findNativeComposerInput(
  root: TestRenderer.ReactTestRenderer,
): TestRenderer.ReactTestInstance {
  return root.root
    .findAllByType(TextInput)
    .find(node => node.props?.testID === 'chat-composer-input')!;
}

/**
 * ComposerAtPathInput 的回推 children：mention 库按 part 渲染的 plain 投影段。
 * 内部为纯文本时只有一段；mention 幸存时按 part 边界分段（tag 段独立成段）。
 */
function composerChildrenPartTexts(
  input: TestRenderer.ReactTestInstance,
): string[] {
  const wrapper = input.props.children as {props: {children: unknown}};
  const partEls = Array.isArray(wrapper.props.children)
    ? (wrapper.props.children as {props: {children: unknown}}[])
    : [wrapper];
  return partEls.map(part => String(part.props.children));
}

describe('ChatComposer integration', () => {
  beforeEach(() => {
    setMobileAgentActive(false);
    mockRunAgentTurn.mockClear();
    mockFilePickerProps.onConfirm = undefined;
    mockGetComposerDraftJson.mockReset();
    mockGetComposerDraftJson.mockResolvedValue(null);
    mockProjectComposerStatus.mockReset();
    mockProjectComposerStatus.mockResolvedValue([]);
    clearChatComposerDraft('s');
    resetChatAnnotateDraftStoreForTests();
    harnessEventBus = undefined;
    harnessManager?.dispose();
    harnessManager = undefined;
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

  it('T22: 同会话已有 in-flight run 时第二次发送被 Manager 拒绝', async () => {
    // 迁移 AgentRunManager 后：门禁从全局 isMobileAgentActive 改为 Manager
    // 的 per-session 拒绝——全局 agentActive 不再拦截发送。
    setMobileAgentActive(true);
    mockRunAgentTurn.mockImplementationOnce(() => new Promise(() => undefined));
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={true} />);
    });
    const input = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.testID === 'chat-composer-input',
    );
    await act(async () => {
      input.props.onChangeText('first');
    });
    const sendBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(1);

    // 第一个 run 仍 in-flight（entry 处 starting）：第二次发送被拒、不再调 run
    await act(async () => {
      input.props.onChangeText('second');
    });
    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(1);
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });

  it('T23: run 早退时 agentActive 回落（Manager finally 兑底）', async () => {
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
    await act(async () => {
      new Promise(resolve => setTimeout(resolve, 0));
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

  it('T23: RUN_FINISHED 已收尾时 finally 不再双减', async () => {
    mockRunAgentTurn.mockImplementationOnce(async () => undefined);
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
    // run 同步完成前先补发 STARTED + FINISHED（事件路径收尾），
    // 再等 finally 链收敛——不应把计数减成负/永久 busy。
    harnessEventBus!.publish(
      'agent.run.started' as never,
      {
        sessionId: 's',
        projectId: 'p',
        runId: 'r1',
      } as never,
    );
    harnessEventBus!.publish(
      'agent.run.finished' as never,
      {
        sessionId: 's',
        projectId: 'p',
        runId: 'r1',
        stopReason: 'end_turn',
      } as never,
    );
    await act(async () => {
      new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(isMobileAgentActive()).toBe(false);
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });

  it('T-P10: append 成功后清批注与输入草稿（失败不清）', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={false} />);
    });
    const input = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.testID === 'chat-composer-input',
    );
    await act(async () => {
      input.props.onChangeText('hello');
    });
    addChatAnnotateDraft('s', {
      name: '/a.md',
      start: 0,
      end: 3,
      text: 'abc',
    } as never);

    // run 内 append 成功后触发 onUserMessageAppended，run 本体继续挂起
    mockRunAgentTurn.mockImplementationOnce(
      async (_rt: unknown, _scope: unknown, _content: string, options: any) => {
        options?.onUserMessageAppended?.();
        return new Promise(() => undefined);
      },
    );
    const sendBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(input.props.value).toBe('');
    expect(listChatAnnotateDrafts('s')).toHaveLength(0);
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });

  it('T-P10: run 失败（append 未达）时草稿保留不清', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={false} />);
    });
    const input = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.testID === 'chat-composer-input',
    );
    await act(async () => {
      input.props.onChangeText('keep me');
    });
    mockRunAgentTurn.mockImplementationOnce(() => new Promise(() => undefined));
    const sendBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(input.props.value).toBe('keep me');
    await act(async () => {
      (tree as TestRenderer.ReactTestRenderer).unmount();
    });
  });

  it('T-P10: onSettled 后 chip 刷新与列表刷新', async () => {
    const onMessagesChanged = jest.fn(async () => undefined);
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <Harness
          canResumeWithoutInput={false}
          onMessagesChanged={onMessagesChanged}
        />,
      );
    });
    const input = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.testID === 'chat-composer-input',
    );
    await act(async () => {
      input.props.onChangeText('hi');
    });
    mockRunAgentTurn.mockImplementationOnce(
      async (_rt: unknown, _scope: unknown, _content: string, options: any) => {
        options?.onUserMessageAppended?.();
        return new Promise(() => undefined);
      },
    );
    const sendBtn = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    await act(async () => {
      sendBtn.props.onPress();
    });
    // 挂载水化已有一文投影调用，记基线；发送后（append 回调）不应额外新增
    const baselineCalls = mockProjectComposerStatus.mock.calls.filter(
      call => call[1] === 's',
    ).length;

    // 驱动 run 终态（STARTED 补 runId 后 FINISHED）
    harnessEventBus!.publish(
      'agent.run.started' as never,
      {
        sessionId: 's',
        projectId: 'p',
        runId: 'r1',
      } as never,
    );
    harnessEventBus!.publish(
      'agent.run.finished' as never,
      {
        sessionId: 's',
        projectId: 'p',
        runId: 'r1',
        stopReason: 'end_turn',
      } as never,
    );
    await act(async () => {
      new Promise(resolve => setTimeout(resolve, 0));
    });

    // onSettled 驱动：chip 投影刷新（projectComposerStatusForSession）+ 列表刷新
    const afterCalls = mockProjectComposerStatus.mock.calls.filter(
      call => call[1] === 's',
    ).length;
    expect(afterCalls).toBeGreaterThan(baselineCalls);
    expect(onMessagesChanged.mock.calls.length).toBeGreaterThan(1);
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

  it('T-CR4①: 库重建值 ≠ 原生上报时自愈回原生文本', async () => {
    // 回归护栏（2026-09 输入变删除案）：emitMentionValue 对账——库差分重建
    // 结果与原生上报不等时以原生文本为准（resolved=truth，一次消费即清空）。
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={false} />);
    });
    const root = tree.root;
    const input = findNativeComposerInput(tree);

    // 构造不等分支：先程序化写入 @/a.md——内部 mentionValue 为 markup 形态
    // （children 分段可见 tag 段），库重建必然把幸存 mention 映射回 markup
    // （getValueFromParts → data.original），与下面的 plain 原生上报必然不等。
    await act(async () => {
      mockFilePickerProps.onConfirm!(['@/a.md']);
    });
    expect(readChatComposerDraftState('s').text).toBe('@/a.md ');
    expect(composerChildrenPartTexts(input)).toEqual(['@/a.md', ' ']);

    // 模拟原生上报：native 侧内容为 plain 投影 + 用户续打（真实库在测试环境
    // 不主动吃字，不等分支由「内部 markup ↔ 上报 plain」构造）。
    const nativeReport = '@/a.md 查一下';
    await act(async () => {
      input.props.onChangeText(nativeReport);
    });

    // 对外 onChangeText 最终收到 mentionValueToPlain(原生上报)，受控 value 同步
    expect(readChatComposerDraftState('s').text).toBe(
      mentionValueToPlain(nativeReport),
    );
    expect(root.findByType(ComposerAtPathInput).props.value).toBe(
      mentionValueToPlain(nativeReport),
    );
    // 对账在 plain 空间比较：库重建（markup）的 plain 投影与原生上报一致，
    // 不触发自愈、直接采用库值——@/a.md tag 幸存（v1.5.9 回归：旧对账拿
    // markup 与 plain 比较恒不等 → resolved=truth → tag 必死）。
    expect(composerChildrenPartTexts(input)).toEqual(['@/a.md', ' 查一下']);
    await act(async () => {
      tree.unmount();
    });
  });

  it('T-CR4②: 对账后 truth 已清空——后续程序化写入不被陈旧 truth 覆盖', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={false} />);
    });
    const root = tree.root;
    const input = findNativeComposerInput(tree);

    // 同①构造：程序化写入 @/a.md（内部 markup）后驱动原生上报，对账消费并清空 truth。
    await act(async () => {
      mockFilePickerProps.onConfirm!(['@/a.md']);
    });
    await act(async () => {
      input.props.onChangeText('@/a.md 查一下');
    });

    // 对账后继续 replaceCommittedText 程序化写入 @/b.md（cursor 停在 token 后，
    // 插入到「查一下」之前）。若 truth 未清空（回归），emitMentionValue 会以
    // 陈旧 truth 覆盖写入——/b.md token 丢失、draft 仍停留在上报文本。
    await act(async () => {
      mockFilePickerProps.onConfirm!(['@/b.md']);
    });

    const expectedMerged = `@/a.md ${formatAtPathMentionMarkup(
      '/b.md',
    )} 查一下`;
    expect(readChatComposerDraftState('s').text).toBe(
      mentionValueToPlain(expectedMerged),
    );
    expect(root.findByType(ComposerAtPathInput).props.value).toBe(
      mentionValueToPlain(expectedMerged),
    );
    // 写入生效且 /a.md、/b.md 均为独立 mention 段（未被陈旧 truth 冲掉）。
    // v1.5.9 修复后首轮对账 tag 幸存，空格成为独立 plain 段。
    expect(composerChildrenPartTexts(input)).toEqual([
      '@/a.md',
      ' ',
      '@/b.md',
      ' 查一下',
    ]);
    await act(async () => {
      tree.unmount();
    });
  });
});
