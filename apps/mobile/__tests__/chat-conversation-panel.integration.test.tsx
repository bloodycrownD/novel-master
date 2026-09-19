import React, {useRef} from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

const mockReload = jest.fn(async () => undefined);

jest.mock('../src/components/vfs/VfsFileManager', () => {
  const React = require('react');
  return {
    VfsFileManager: React.forwardRef(
      (_props: unknown, ref: React.Ref<{reload: () => Promise<void>}>) => {
        React.useImperativeHandle(ref, () => ({
          canGoUp: () => false,
          goUp: () => undefined,
          reload: mockReload,
        }));
        return null;
      },
    ),
  };
});

jest.mock('../src/components/chat/ChatComposer', () => ({
  ChatComposer: () => null,
}));
// ChatMetaBar 的可交互骨架（au/B-1 / au/G-4 用例的断言面）：把 onPressAgent
// 暴露为可按压节点，测试经 testID 触发；meta 仅供透传，不消费。
jest.mock('../src/components/chat/ChatMetaBar', () => {
  const mockReact = require('react');
  return {
    ChatMetaBar: (props: {onPressAgent?: () => void}) =>
      mockReact.createElement('View', {
        testID: 'chat-meta-agent-card',
        onPress: props.onPressAgent,
      }),
  };
});
jest.mock('../src/components/chat/ChatStreamMetricsBarLive', () => ({
  ChatStreamMetricsBarLive: () => null,
}));

// webview mock：经 ref 暴露可记录的 commitSyntheticAssistantRow（ui/B-1
// 中断现场用例的断言面）；组件本体渲染 null，其余 props 不消费。
const mockCommitSyntheticAssistantRow = jest.fn(() => true);
jest.mock('../src/components/chat/ChatTranscriptWebView', () => {
  const mockReact = require('react');
  return {
    ChatTranscriptWebView: mockReact.forwardRef(
      (
        _props: unknown,
        ref: React.Ref<{commitSyntheticAssistantRow: unknown}>,
      ) => {
        mockReact.useImperativeHandle(ref, () => ({
          commitSyntheticAssistantRow: mockCommitSyntheticAssistantRow,
        }));
        return null;
      },
    ),
  };
});
jest.mock('../src/components/chat/MessageList', () => ({
  MessageList: () => null,
}));
jest.mock('../src/components/chat/MessageActionMenu', () => ({
  MessageActionMenu: () => null,
}));
jest.mock('../src/components/chat/MessageEditModal', () => ({
  MessageEditModal: () => null,
}));
jest.mock('../src/components/provider/ModelPickerModal', () => ({
  ModelPickerModal: () => null,
}));
jest.mock('../src/components/agent/AgentPickerModal', () => ({
  AgentPickerModal: () => null,
}));
jest.mock('../src/components/sheet/BottomSheetMenu', () => ({
  BottomSheetMenu: () => null,
}));
// BottomSheetMenu 的骨架（ModalShell）内部用 useTheme，mock 掉避免拉起 runtime 链。
jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({tokens: {surface: '#111'}}),
}));
// toast 记录用模块级 mock：组件每次渲染取到的 showToast 是同一实例，
// 断言（重选/锁定提示文案）才能拿到调用记录。
const mockShowToast = jest.fn();
jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

import {ChatConversationPanel} from '../src/screens/tabs/chat-tab/ChatConversationPanel';
import type {VfsFileManagerHandle} from '../src/components/vfs/VfsFileManager';
import type {SessionStreamUnitView} from '../src/services/session-stream-unit';

const tokens = {
  background: '#000',
  surface: '#111',
  surfaceElevated: '#111',
  border: '#222',
  borderLight: '#222',
  text: '#fff',
  textSecondary: '#ccc',
  textTertiary: '#777',
  primary: '#08f',
  danger: '#f00',
  bgSecondary: '#222',
  headerBackground: '#111',
  tabBarBackground: '#111',
  tabBarActive: '#08f',
  tabBarInactive: '#666',
  overlay: 'rgba(0,0,0,0.5)',
  success: '#0a0',
  warning: '#fa0',
};

let mockConversationPanel: 'chat' | 'workspace' = 'chat';
const mockSetConversationPanel = jest.fn((panel: 'chat' | 'workspace') => {
  mockConversationPanel = panel;
});
// 按用例可变的 agentMeta（au/B-1 断言面）：默认正常 session meta，
// 未加载窗口用例置 undefined、已删待重选用例置 source='none'。
let mockAgentMeta:
  | {
      source: 'session' | 'none';
      agentId: string | undefined;
      agentName: string;
      hasDedicatedModel: boolean;
      modelLabel: string;
      tokenLabel: string;
      modelSource: 'agent-pin' | 'session';
    }
  | undefined = {
  source: 'session',
  agentId: 'a1',
  agentName: 'A',
  hasDedicatedModel: false,
  modelLabel: 'Model',
  tokenLabel: '',
  modelSource: 'session',
};

// agent picker 开关记录（au/B-1 断言面）：模块级 mock，跨渲染可断言。
const mockSetAgentPickerOpen = jest.fn();

function makeMockContext(
  workspaceVfsRef: React.RefObject<VfsFileManagerHandle | null>,
) {
  return {
    projectId: 'p1',
    sessionId: 's1',
    conversationPanel: mockConversationPanel,
    setConversationPanel: mockSetConversationPanel,
    chatSubview: 'conversation' as const,
    setChatSubview: jest.fn(),
    agentMeta: mockAgentMeta,
    uiRunning: false,
    agentActive: false,
    activeRunId: null,
    streamTailGenerating: false,
    streamingText: '',
    streamingThinking: '',
    streamMetricsLastRun: null,
    streamMetricsAccRef: {current: null},
    onStreamReset: jest.fn(),
    chatMessages: [],
    hasMoreMessages: false,
    loadingMoreMessages: false,
    onMessagesChanged: jest.fn(),
    canResumeWithoutInput: false,
    lastMessageIsPlainUserText: false,
    sessionVfs: {} as any,
    sessionWorktree: {} as any,
    vfsRefreshKey: 0,
    hasWorkspaceModel: false,
    bumpWorktreeUiToken: jest.fn(),
    chatScrollKey: 'p1:s1',
    cachedChatScroll: undefined,
    restoredTranscriptScroll: undefined,
    defaultChatScrollToBottom: true,
    onChatScrollSnapshot: jest.fn(),
    sessionDrawerOpen: false,
    setSessionDrawerOpen: jest.fn(),
    modelPickerOpen: false,
    setModelPickerOpen: jest.fn(),
    agentPickerOpen: false,
    setAgentPickerOpen: mockSetAgentPickerOpen,
    messageMenuTarget: undefined,
    messageMenuAnchor: undefined,
    setMessageMenuTarget: jest.fn(),
    setMessageMenuAnchor: jest.fn(),
    messageEditPrompt: undefined,
    setMessageEditPrompt: jest.fn(),
    useWebviewTranscript: false,
    chatRichTextEnabled: false,
    richRenderEpoch: 0,
    webMenuCloseSignal: 0,
    webMenuOpen: false,
    setWebMenuOpen: jest.fn(),
    beginUiRun: jest.fn(),
    abortUiRun: jest.fn(),
    onLoadOlderMessages: jest.fn(),
    onOpenFileEditor: jest.fn(),
    onNeedModel: jest.fn(),
    onRefreshChatMeta: jest.fn(),
    transcriptWebRef: {current: null},
    workspaceVfsRef,
    scope: {
      sessionRenamePrompt: undefined,
      setSessionRenamePrompt: jest.fn(),
      refreshChatTokenLabel: jest.fn(),
      reloadLists: jest.fn(async () => undefined),
    },
    messages: {hydrateFromSessionCache: jest.fn()},
    resetStreamingDisplay: jest.fn(),
    navigation: {} as any,
    showToast: jest.fn(),
    runtime: {} as any,
    setCurrentSession: jest.fn(async () => undefined),
    closeMessageMenu: jest.fn(),
  };
}

jest.mock('../src/screens/tabs/chat-tab/ChatTabProvider', () => ({
  useChatTabContext: jest.fn(),
}));

jest.mock('../src/screens/tabs/chat-tab/useChatTabController', () => ({
  useChatTabController: () => ({
    handleMessageLongPress: jest.fn(),
    handleMessageMenuSelect: jest.fn(),
    handleWebMessageMenuAction: jest.fn(),
    handleSaveMessageEdit: jest.fn(async () => undefined),
    confirmBatchDeleteSessions: jest.fn(),
    handleCompactSession: jest.fn(),
    onNavigateRealPrompt: jest.fn(),
    handleCapturePromptFileBlock: jest.fn(),
  }),
}));

jest.mock('../src/screens/tabs/chat-tab/ChatTabNavigationProvider', () => ({
  useChatTabWorkspaceBackState: () => jest.fn(),
}));

import {useChatTabContext} from '../src/screens/tabs/chat-tab/ChatTabProvider';

const mockUseChatTabContext = useChatTabContext as jest.MockedFunction<
  typeof useChatTabContext
>;

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function TestHost() {
  const workspaceVfsRef = useRef<VfsFileManagerHandle>(null);
  mockUseChatTabContext.mockReturnValue(
    makeMockContext(workspaceVfsRef) as ReturnType<typeof useChatTabContext>,
  );
  return <ChatConversationPanel tokens={tokens} visible />;
}

describe('ChatConversationPanel workspace reload', () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    mockReload.mockClear();
    mockConversationPanel = 'chat';
  });

  afterEach(() => {
    if (tree != null) {
      act(() => {
        tree!.unmount();
      });
    }
    tree = undefined;
  });

  it('切入 workspace 时调用 VfsFileManager.reload()', async () => {
    mockConversationPanel = 'workspace';
    await act(async () => {
      tree = TestRenderer.create(<TestHost />);
      await flushPromises();
    });

    expect(mockReload).toHaveBeenCalled();
  });

  it('chat → workspace 切换时再次 reload()', async () => {
    mockConversationPanel = 'chat';
    await act(async () => {
      tree = TestRenderer.create(<TestHost />);
      await flushPromises();
    });
    mockReload.mockClear();

    mockConversationPanel = 'workspace';
    await act(async () => {
      tree!.update(<TestHost />);
      await flushPromises();
    });

    expect(mockReload).toHaveBeenCalled();
  });
});

// ── 中断现场合成行提交（cr-fix-spec ui/B-1 / ui/C-1）─────────────────────
//
// 时序背景：重进 interrupted 会话的常态是 tail（单元投影水合）先于 webview
// ready 到达——webReady=false 时 commitSyntheticAssistantRow 被组件守卫拒绝
// 且不置去重键，若 effect 只依赖投影变化，此后永不重跑、partial 永不提交。
// 修复把 ready 世代（ctx.transcriptReadyEpoch）纳入依赖，ready 后补交。

/** interrupted 投影工厂：默认携带非空 partial（runId/settledAtMs 固定）。 */
function interruptedUnitView(
  overrides?: Partial<SessionStreamUnitView>,
): SessionStreamUnitView {
  return {
    sessionId: 's1',
    projectId: 'p1',
    status: 'interrupted',
    runId: 'run-1',
    settledAtMs: 1234,
    metrics: {textChars: 5, thinkingChars: 2},
    startedAtMs: 100,
    elapsedMs: 1134,
    partialText: '中断前的正文',
    partialThinking: '中断前的思考',
    injected: false,
    pendingChildren: [],
    pendingChildrenByTitle: new Map(),
    messages: [],
    hasMoreMessages: false,
    loadingMoreMessages: false,
    ...overrides,
  };
}

describe('ChatConversationPanel 中断现场合成行提交（ui/B-1）', () => {
  // 时序驱动变量：模拟 Provider 侧的投影水合与 ready 世代推进。
  let mockUnitView: SessionStreamUnitView | null;
  let mockReadyEpoch: number;

  function InterruptedTestHost() {
    const workspaceVfsRef = useRef<VfsFileManagerHandle>(null);
    const ctx = makeMockContext(workspaceVfsRef) as ReturnType<
      typeof useChatTabContext
    > & {
      unitView: SessionStreamUnitView | null;
      transcriptReadyEpoch: number;
    };
    ctx.unitView = mockUnitView;
    ctx.transcriptReadyEpoch = mockReadyEpoch;
    ctx.useWebviewTranscript = true;
    mockUseChatTabContext.mockReturnValue(ctx);
    return <ChatConversationPanel tokens={tokens} visible />;
  }

  let tree: TestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    mockCommitSyntheticAssistantRow.mockClear().mockReturnValue(true);
    mockUnitView = interruptedUnitView();
    mockReadyEpoch = 0;
  });

  afterEach(() => {
    if (tree != null) {
      act(() => {
        tree!.unmount();
      });
    }
    tree = undefined;
  });

  it('ui/B-1: 进入 interrupted 会话、tail 先于 webview ready，ready 后合成行仍提交', async () => {
    await act(async () => {
      tree = TestRenderer.create(<InterruptedTestHost />);
      await flushPromises();
    });

    // tail（投影水合）已到、webview 未 ready：不提交（守卫拒绝且不置键）
    expect(mockCommitSyntheticAssistantRow).not.toHaveBeenCalled();

    // webview ready：ready 世代递增（Provider 的 onReady bump），effect 重跑补交
    mockReadyEpoch = 1;
    await act(async () => {
      tree!.update(<InterruptedTestHost />);
      await flushPromises();
    });

    expect(mockCommitSyntheticAssistantRow).toHaveBeenCalledTimes(1);
    expect(mockCommitSyntheticAssistantRow).toHaveBeenCalledWith(
      '中断前的正文',
      '中断前的思考',
    );
  });

  it('ui/B-1: 同一中断现场不重复提交（runId+settledAtMs 去重），webview 重挂后重新提交', async () => {
    mockReadyEpoch = 1;
    await act(async () => {
      tree = TestRenderer.create(<InterruptedTestHost />);
      await flushPromises();
    });
    expect(mockCommitSyntheticAssistantRow).toHaveBeenCalledTimes(1);

    // 同一 run 的投影再次换新引用（字段微变，runId+settledAtMs 不变）：
    // 不重复提交
    mockUnitView = interruptedUnitView({metrics: {textChars: 99, thinkingChars: 2}});
    await act(async () => {
      tree!.update(<InterruptedTestHost />);
      await flushPromises();
    });
    expect(mockCommitSyntheticAssistantRow).toHaveBeenCalledTimes(1);

    // webview 重挂：ready 世代递增 = 新空基线（落库行经快照链重推，合成行
    // 不在落库消息里），同键须在新世代重新提交
    mockReadyEpoch = 2;
    await act(async () => {
      tree!.update(<InterruptedTestHost />);
      await flushPromises();
    });
    expect(mockCommitSyntheticAssistantRow).toHaveBeenCalledTimes(2);
  });
});

// ── 顶栏 agent 卡三态分流（cr-fix-spec 条目 4 / 11，au/B-1）───────────────
//
// agentMeta 拆分后的三态口径：undefined（未加载）→ 锁定，弹「加载中」提示、
// 不开 picker；source='none'（已删待重选）→ 弹重选 toast 并正常开 picker；
// source='session' → 直接开 picker（既有行为，见下方默认态用例组不重复覆盖）。
describe('ChatConversationPanel 顶栏 agent 卡分流（au/B-1 / au/G-4）', () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    mockShowToast.mockClear();
    mockSetAgentPickerOpen.mockClear();
    mockConversationPanel = 'chat';
    mockAgentMeta = {
      source: 'session',
      agentId: 'a1',
      agentName: 'A',
      hasDedicatedModel: false,
      modelLabel: 'Model',
      tokenLabel: '',
      modelSource: 'session',
    };
  });

  afterEach(() => {
    if (tree != null) {
      act(() => {
        tree!.unmount();
      });
    }
    tree = undefined;
  });

  it('验收a（条目4/11）：none 态点 agent 卡弹重选 toast 并打开 picker', async () => {
    // loadChatAgentMeta 在 AgentRunResolveError 时归一落位的 none meta
    mockAgentMeta = {
      source: 'none',
      agentId: undefined,
      agentName: '未配置 Agent',
      hasDedicatedModel: false,
      modelLabel: '—',
      tokenLabel: '',
      modelSource: 'session',
    };
    await act(async () => {
      tree = TestRenderer.create(<TestHost />);
      await flushPromises();
    });
    await act(async () => {
      tree!.root
        .findByProps({testID: 'chat-meta-agent-card'})
        .props.onPress();
    });
    expect(mockShowToast).toHaveBeenCalledWith('智能体已被删除，请重新选择');
    expect(mockSetAgentPickerOpen).toHaveBeenCalledWith(true);
  });

  it('验收b（条目4/11）：meta 未加载（undefined）点 agent 卡不开 picker，弹加载中提示', async () => {
    // EMPTY→loaded 在途窗口：agentMeta 为 undefined（不再有 source:'none' 占位）
    mockAgentMeta = undefined;
    await act(async () => {
      tree = TestRenderer.create(<TestHost />);
      await flushPromises();
    });
    await act(async () => {
      tree!.root
        .findByProps({testID: 'chat-meta-agent-card'})
        .props.onPress();
    });
    // 未加载锁：只提示加载中，绝不开 picker、绝不出「已删」语义
    expect(mockShowToast).toHaveBeenCalledWith('智能体信息加载中，请稍候再试');
    expect(mockShowToast).not.toHaveBeenCalledWith(
      '智能体已被删除，请重新选择',
    );
    expect(mockSetAgentPickerOpen).not.toHaveBeenCalled();
  });
});
