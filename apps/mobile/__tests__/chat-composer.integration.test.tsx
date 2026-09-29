import React from 'react';
import {describe, expect, it, jest} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Alert} from 'react-native';

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

// T-INT：捕获两个 typeahead 的 onSelect，驱动「点选 → 单路径整段写入」护栏。
// （组件本体改由 mock 捕获；候选过滤等纯函数走 SkillTypeahead 的其余导出。）
const mockAtPathTypeaheadProps: {onSelect?: (token: string) => void} = {};
jest.mock('../src/components/chat/AtPathTypeahead', () => ({
  AtPathTypeahead: (props: {onSelect: (token: string) => void}) => {
    mockAtPathTypeaheadProps.onSelect = props.onSelect;
    return null;
  },
}));

const mockSkillTypeaheadProps: {onSelect?: (name: string) => void} = {};
jest.mock('../src/components/chat/SkillTypeahead', () => {
  const actual = jest.requireActual(
    '../src/components/chat/SkillTypeahead',
  ) as Record<string, unknown>;
  return {
    ...actual,
    SkillTypeahead: (props: {onSelect: (name: string) => void}) => {
      mockSkillTypeaheadProps.onSelect = props.onSelect;
      return null;
    },
  };
});

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
  COMPOSER_INPUT_BRIDGE_VERSION,
  decodeHostToComposerInput,
  type HostToComposerInputMessage,
} from '../src/components/chat/ComposerInputBridge';
import {
  clearMockWebViewPostMessages,
  mockWebViewPostMessages,
} from '../test-utils/react-native-webview-mock';
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
 * 找 composer 宿主（WebView 化后输入驱动入口）。
 *
 * 判据用 `source.uri`：composer 宿主的 URI 走 composer-input 包
 * （`.../webview/composer-input/index.html`），transcript 宿主是另一个包——
 * 页面里并存多个 WebView 时按包名区分，不用「第几个」这种位置判据。
 */
function findComposerWebView(
  root: TestRenderer.ReactTestInstance,
): TestRenderer.ReactTestInstance {
  const WebViewMock = require('react-native-webview')
    .default as React.ComponentType<unknown>;
  const node = root
    .findAllByType(WebViewMock)
    .find(instance =>
      String(instance.props?.source?.uri ?? '').includes('composer-input'),
    );
  if (node == null) {
    throw new Error('composer WebView 未挂载');
  }
  return node;
}

/** 模拟 web → host 上报（信封 v 取本包 BRIDGE_V）。 */
function simulateWebMessage(
  root: TestRenderer.ReactTestInstance,
  type: string,
  payload: Record<string, unknown> = {},
): void {
  const webView = findComposerWebView(root);
  act(() => {
    webView.props.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({v: COMPOSER_INPUT_BRIDGE_VERSION, type, payload}),
      },
    });
  });
}

/** chat 壳实例：对外 value / cursor 的观察点（ChatComposer 受控下传）。 */
function composerShell(
  root: TestRenderer.ReactTestInstance,
): TestRenderer.ReactTestInstance {
  return root.findByType(ComposerAtPathInput);
}

function hostMessagesFrom(clearAfterIndex: number): HostToComposerInputMessage[] {
  return mockWebViewPostMessages
    .slice(clearAfterIndex)
    .map(raw => decodeHostToComposerInput(raw));
}

function hostTypesSince(clearAfterIndex: number): string[] {
  return hostMessagesFrom(clearAfterIndex).map(message => message.type);
}

function hostPayloadOfType(clearAfterIndex: number, type: string): unknown {
  const found = hostMessagesFrom(clearAfterIndex).find(
    message => message.type === type,
  );
  return found == null ? null : found.payload;
}

/** 冲净 effect 与异步批（real timers）。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
  });
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
    clearMockWebViewPostMessages();
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
    const root = (tree as TestRenderer.ReactTestRenderer).root;
    // 输入驱动走桥协议：web 侧自持真源，change 上报 plain 文本。
    simulateWebMessage(root, 'change', {text: 'first'});
    const sendBtn = root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(1);

    // 第一个 run 仍 in-flight（entry 处 starting）：第二次发送被拒、不再调 run
    simulateWebMessage(root, 'change', {text: 'second'});
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
    const root = (tree as TestRenderer.ReactTestRenderer).root;
    expect(composerShell(root).props.value).toBe('restored text');

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
    expect(composerShell(root).props.value).toBe('after rollback');
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
    const root = (tree as TestRenderer.ReactTestRenderer).root;
    simulateWebMessage(root, 'change', {text: 'after tool result'});
    const sendBtn = root.find(
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
    const root = (tree as TestRenderer.ReactTestRenderer).root;
    simulateWebMessage(root, 'change', {text: 'hello'});
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
    const sendBtn = root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(composerShell(root).props.value).toBe('');
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
    const root = (tree as TestRenderer.ReactTestRenderer).root;
    simulateWebMessage(root, 'change', {text: 'keep me'});
    mockRunAgentTurn.mockImplementationOnce(() => new Promise(() => undefined));
    const sendBtn = root.find(
      node => node.props?.accessibilityLabel === '发送',
    );
    await act(async () => {
      sendBtn.props.onPress();
    });
    expect(composerShell(root).props.value).toBe('keep me');
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
    const root = (tree as TestRenderer.ReactTestRenderer).root;
    simulateWebMessage(root, 'change', {text: 'hi'});
    mockRunAgentTurn.mockImplementationOnce(
      async (_rt: unknown, _scope: unknown, _content: string, options: any) => {
        options?.onUserMessageAppended?.();
        return new Promise(() => undefined);
      },
    );
    const sendBtn = root.find(
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

  it('T-CR4①: 程序化整段写入 → 续打只认 web 上报的 plain、宿主不回写', async () => {
    // 回归护栏（2026-09 输入变删除案 / v1.5.9 防线）的协议版：程序化写入
    // （选择器 → replaceCommittedText）之后用户续打，value 必须与 web 上报严格
    // 相等（plain、不丢 token），且 change 上报绝不触发 setText 回写——回写会
    // 打断 IME 组合态。
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={false} />);
    });
    const root = tree.root;
    simulateWebMessage(root, 'ready', {version: COMPOSER_INPUT_BRIDGE_VERSION});
    await flush();

    // 程序化写入：@ 选择器确认 → buildTokenInsertion + replaceCommittedText
    // （单路径）→ 宿主 setText{text, selection} 一次落位。
    const writeBaseline = mockWebViewPostMessages.length;
    await act(async () => {
      mockFilePickerProps.onConfirm!(['@/a.md']);
    });
    expect(hostPayloadOfType(writeBaseline, 'setText')).toEqual({
      text: '@/a.md ',
      selectionStart: 7,
      selectionEnd: 7,
    });
    expect(readChatComposerDraftState('s').text).toBe('@/a.md ');

    // 模拟 web 续打上报：plain 投影 + 新字（markup 从不进 web textarea）。
    const report = '@/a.md 查一下';
    const changeBaseline = mockWebViewPostMessages.length;
    simulateWebMessage(root, 'change', {text: report});
    await flush();

    // 对外 value 与 web 上报严格相等（plain），draft 同步。
    expect(composerShell(root).props.value).toBe(report);
    expect(readChatComposerDraftState('s').text).toBe(report);
    expect(report.includes('{@}')).toBe(false);
    // 打字不回写：change 之后不得有 setText（web 自持真源）。
    expect(hostTypesSince(changeBaseline)).not.toContain('setText');
    await act(async () => {
      tree.unmount();
    });
  });

  it('T-CR4②: 连续两次程序化写入互不覆盖（多 token 序列，plain 合并正确）', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={false} />);
    });
    const root = tree.root;
    simulateWebMessage(root, 'ready', {version: COMPOSER_INPUT_BRIDGE_VERSION});
    await flush();

    // 第一次程序化写入 @/a.md，随后 web 续打（光标停在 token 后）。
    await act(async () => {
      mockFilePickerProps.onConfirm!(['@/a.md']);
    });
    simulateWebMessage(root, 'change', {text: '@/a.md 查一下'});
    await flush();

    // 第二次程序化写入 @/b.md：从光标（token 后的位置）插入到「查一下」之前。
    // 回归口径：旧实现的陈旧对账 truth 会把第二次写入整段覆盖掉，两个 token
    // 都活不下来。
    const secondBaseline = mockWebViewPostMessages.length;
    await act(async () => {
      mockFilePickerProps.onConfirm!(['@/b.md']);
    });

    const expectedMerged = '@/a.md @/b.md 查一下';
    expect(hostPayloadOfType(secondBaseline, 'setText')).toEqual({
      text: expectedMerged,
      selectionStart: 14,
      selectionEnd: 14,
    });
    expect(composerShell(root).props.value).toBe(expectedMerged);
    expect(readChatComposerDraftState('s').text).toBe(expectedMerged);
    // 两次插入独立幸存：两个 token 各出现一次，且无 markup 残留。
    expect(expectedMerged.indexOf('@/a.md')).toBe(0);
    expect(expectedMerged.split('@/b.md')).toHaveLength(2);
    expect(expectedMerged.includes('{@}')).toBe(false);
    await act(async () => {
      tree.unmount();
    });
  });

  it('T-INT: typeahead 点选走单路径——plain + 补尾空格 + 光标落位 + 宿主 setText', async () => {
    // 变更 10 的护栏：`@` / `$` typeahead 点选不再走 mentions onSelect，
    // 与选择器插入共用 buildTokenInsertion + replaceCommittedText 单路径。
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={false} />);
    });
    const root = tree.root;
    simulateWebMessage(root, 'ready', {version: COMPOSER_INPUT_BRIDGE_VERSION});
    await flush();

    // 手输「见 @a」：change 上报文本 + selectionChange 落光标（typeahead 开合靠它）。
    simulateWebMessage(root, 'change', {text: '见 @a'});
    simulateWebMessage(root, 'selectionChange', {start: 4, end: 4});
    await flush();

    const atBaseline = mockWebViewPostMessages.length;
    act(() => {
      mockAtPathTypeaheadProps.onSelect!('@/a.md');
    });
    expect(hostPayloadOfType(atBaseline, 'setText')).toEqual({
      text: '见 @/a.md ',
      selectionStart: 9,
      selectionEnd: 9,
    });
    expect(composerShell(root).props.value).toBe('见 @/a.md ');
    expect(composerShell(root).props.cursor).toBe(9);
    expect(composerShell(root).props.value.endsWith(' ')).toBe(true);
    expect(readChatComposerDraftState('s').text).toBe('见 @/a.md ');

    // `$` 技能 typeahead 同路径：`$技能名` + 补尾空格 + 光标落位。
    simulateWebMessage(root, 'change', {text: '再看 $写'});
    simulateWebMessage(root, 'selectionChange', {start: 6, end: 6});
    await flush();

    const skillBaseline = mockWebViewPostMessages.length;
    act(() => {
      mockSkillTypeaheadProps.onSelect!('写作技能');
    });
    expect(hostPayloadOfType(skillBaseline, 'setText')).toEqual({
      text: '再看 $写作技能 ',
      selectionStart: 9,
      selectionEnd: 9,
    });
    expect(composerShell(root).props.value).toBe('再看 $写作技能 ');
    expect(composerShell(root).props.cursor).toBe(9);
    expect(composerShell(root).props.value.endsWith(' ')).toBe(true);
    await act(async () => {
      tree.unmount();
    });
  });

  it('T-IME1: 组合态 churn 序列——value 与最后上报严格相等、不丢字、零回写', async () => {
    // IME 组合态无法在 jest 里构造原生 composition 事件（RN 时代即如此），
    // 用 change 消息序列（含拼到一半的拼音串）守护：每个中间态都必须原样落地，
    // 且不得有任何宿主回写（回写 = 组合态被打断、候选窗乱跳的根因）。
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={false} />);
    });
    const root = tree.root;
    simulateWebMessage(root, 'ready', {version: COMPOSER_INPUT_BRIDGE_VERSION});
    await flush();

    const sequence = ['n', 'ni', 'nih', 'niha', 'nihao', '你好', '你好世', '你好世界'];
    const baseline = mockWebViewPostMessages.length;
    for (const text of sequence) {
      simulateWebMessage(root, 'change', {text});
      expect(composerShell(root).props.value).toBe(text);
    }
    // 最后上报即最终值：不丢字、无合并残留。
    expect(readChatComposerDraftState('s').text).toBe('你好世界');
    expect(hostTypesSince(baseline)).not.toContain('setText');
    await act(async () => {
      tree.unmount();
    });
  });

  it('T-IME2: 带 token 长文续打 value 恒 plain（token 原样、不被 markup 化）', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness canResumeWithoutInput={false} />);
    });
    const root = tree.root;
    simulateWebMessage(root, 'ready', {version: COMPOSER_INPUT_BRIDGE_VERSION});
    await flush();

    // 程序化写入一个 @path token（草稿水化 / 点选等价通路），再续打长文。
    await act(async () => {
      mockFilePickerProps.onConfirm!(['/chapters/01.md']);
    });
    const long = `${'这是一段很长的续打文本，'.repeat(20)}请接着写`;
    const report = `看 @/chapters/01.md 这段${long}`;
    simulateWebMessage(root, 'change', {text: report});
    await flush();

    const value = composerShell(root).props.value as string;
    expect(value).toBe(report);
    expect(value.split('@/chapters/01.md')).toHaveLength(2);
    expect(value.includes('{@}')).toBe(false);
    expect(value.includes('</')).toBe(false);
    expect(readChatComposerDraftState('s').text).toBe(report);
    await act(async () => {
      tree.unmount();
    });
  });
});
