import React, {useRef} from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

const mockReload = jest.fn(async () => undefined);

// 生命周期流水（跨会话重挂回归锁的断言面）：mock 组件 mount/unmount 各记一行，
// 用例按 toEqual 断言完整序列（mount→unmount→mount / 仅一次 mount）。
const mockVfsLifecycle: string[] = [];

jest.mock('../src/components/vfs/VfsFileManager', () => {
  const React = require('react');
  return {
    VfsFileManager: React.forwardRef(
      (_props: unknown, ref: React.Ref<{reload: () => Promise<void>}>) => {
        React.useEffect(() => {
          mockVfsLifecycle.push('mount');
          return () => {
            mockVfsLifecycle.push('unmount');
          };
        }, []);
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

// 统一宿主 mock（chat-webview-unify Step 7：webview 分支改挂 ChatConversationWebView，
// 单实例承载转录 + dock）。经 ref 暴露可记录的 commitSyntheticAssistantRow
// （ui/B-1 中断现场用例的断言面）；组件本体渲染 null，其余 props 不消费。
//
// 第二阶段起这层 mock 还多担一件事：**抓 props**——`viewState` 就是宿主从
// `chatSubview` 映射出来的 `view` prop（面板 → WebView → 下行消息），
// viewState 断言面的第一环就落在这里。
const mockCommitSyntheticAssistantRow = jest.fn(() => true);
const mockWebViewPropsList: Array<Record<string, unknown>> = [];
jest.mock('../src/components/chat/ChatConversationWebView', () => {
  const mockReact = require('react');
  return {
    ChatConversationWebView: mockReact.forwardRef(
      (
        props: unknown,
        ref: React.Ref<{commitSyntheticAssistantRow: unknown}>,
      ) => {
        mockWebViewPropsList.push(props as Record<string, unknown>);
        mockReact.useImperativeHandle(ref, () => ({
          commitSyntheticAssistantRow: mockCommitSyntheticAssistantRow,
        }));
        return null;
      },
    ),
  };
});

// composer controller 的运行时依赖（webview 分支会真挂 controller）。
// 面板测试关心的是布局/接线/中断现场，controller 内部行为由
// use-chat-composer-controller.test.tsx 单独覆盖，这里只把外部依赖喂到不抛。
const mockRuntime: Record<string, any> = {};
jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));
jest.mock('../src/services/project-composer-status.service', () => ({
  projectComposerStatusForSession: jest.fn(async () => []),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
// 两个 RN Modal 选择器（面板直挂）：只挡掉真实 Modal 依赖。
jest.mock('../src/components/chat/FileReferencePicker', () => ({
  FileReferencePicker: () => null,
}));
jest.mock('../src/components/skills/SkillPicker', () => ({
  SkillPicker: () => null,
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
import {clearChatComposerDraft} from '../src/storage/chat-composer-draft';

/**
 * 灌一个够 controller 跑起来的 mock runtime（草稿水化 + 两路候选源拉取 + 发送决策）。
 * 本文件不覆盖 controller 语义（那是 use-chat-composer-controller.test.tsx 的职责），
 * 只保证它挂上去不抛、且草稿 store 不跨用例残留。
 */
function installMockRuntime(): void {
  Object.assign(mockRuntime, {
    preferences: {getLlmStreamEnabled: jest.fn(async () => true)},
    sessions: {
      get: jest.fn(async () => ({id: 's1', projectId: 'p1'})),
      getComposerDraftJson: jest.fn(async () => null),
      setComposerDraftJson: jest.fn(async () => true),
    },
    workplace: jest.fn(() => ({
      buildListRows: jest.fn(async () => [
        {path: '/', kind: 'dir'},
        {path: '/a.md', kind: 'file'},
      ]),
    })),
    skills: jest.fn(() => ({effectiveSkills: jest.fn(async () => [])})),
    sessionStreamUnitManager: {
      startRun: jest.fn(async () => ({ok: true})),
      stopRun: jest.fn(),
    },
  });
}

/**
 * 列表域（第二阶段）的 manager 判活桩：挂在 **ctx.runtime** 上（面板侧的
 * `useSessionListBridge` 从 ctx.runtime 取，不是 `useRuntime()`——同一个对象，
 * 但测试里 ctx.runtime 是独立字段，得单独喂）。
 */
const mockListManager = {
  activeSessionIds: jest.fn((): readonly string[] => []),
  interruptedSessionIds: jest.fn((): ReadonlySet<string> => new Set()),
  subscribe: jest.fn((listener: () => void) => {
    mockListListeners.push(listener);
    return () => undefined;
  }),
  stopRun: jest.fn(),
};

/** manager 订阅捕获：手动驱动 listener 验证判活刷新接线。 */
const mockListListeners: Array<() => void> = [];

/** 批量选择态桩（真源在 ChatTabScreen，这里只做注入）。 */
const mockSessionBatch = {
  active: false,
  selectedIds: new Set<string>(),
  enter: jest.fn(),
  exit: jest.fn(),
  toggle: jest.fn(),
};

const mockOpenConversation = jest.fn();

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
// 按用例可变的 sessionId（跨会话重挂回归锁）：默认 's1'，用例内切 's2' 模拟换会话。
let mockSessionId: string | null = 's1';
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
    sessionId: mockSessionId,
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
    restoredTranscriptScroll: undefined,
    defaultChatScrollToBottom: true,
    onChatScrollSnapshot: jest.fn(),
    sessionDrawerOpen: false,
    setSessionDrawerOpen: jest.fn(),
    modelPickerOpen: false,
    setModelPickerOpen: jest.fn(),
    agentPickerOpen: false,
    setAgentPickerOpen: mockSetAgentPickerOpen,
    messageEditPrompt: undefined,
    setMessageEditPrompt: jest.fn(),
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
      // ---- 列表域（第二阶段） ----
      sessions: [],
      menuSessionId: undefined,
      setMenuSessionId: jest.fn(),
      openSessionRenamePrompt: jest.fn(),
      handleCopySession: jest.fn(async () => undefined),
      confirmDeleteSession: jest.fn(),
      handleCreateSession: jest.fn(async () => undefined),
    },
    messages: {hydrateFromSessionCache: jest.fn()},
    resetStreamingDisplay: jest.fn(),
    navigation: {} as any,
    showToast: jest.fn(),
    runtime: {sessionStreamUnitManager: mockListManager} as any,
    setCurrentSession: jest.fn(async () => undefined),
    closeMessageMenu: jest.fn(),
  };
}

jest.mock('../src/screens/tabs/chat-tab/ChatTabProvider', () => ({
  useChatTabContext: jest.fn(),
}));

jest.mock('../src/screens/tabs/chat-tab/useChatTabController', () => ({
  useChatTabController: () => ({
    onWebMenuOpenChange: jest.fn(),
    onWebMessageMenuAction: jest.fn(),
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
import {sameStringSet} from '../src/screens/tabs/chat-tab/useSessionListBridge';

const mockUseChatTabContext = useChatTabContext as jest.MockedFunction<
  typeof useChatTabContext
>;

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

beforeEach(() => {
  installMockRuntime();
  clearChatComposerDraft('s1');
  mockVfsLifecycle.length = 0;
  mockSessionId = 's1';
  mockWebViewPropsList.length = 0;
  mockListListeners.length = 0;
  mockListManager.activeSessionIds.mockReturnValue([]);
  mockListManager.interruptedSessionIds.mockReturnValue(new Set());
  mockListManager.stopRun.mockClear();
  mockOpenConversation.mockClear();
  mockSessionBatch.active = false;
  mockSessionBatch.selectedIds = new Set();
  mockSessionBatch.enter.mockClear();
  mockSessionBatch.exit.mockClear();
  mockSessionBatch.toggle.mockClear();
});

/** 取最近一次渲染时统一宿主收到的 props（viewState 断言面）。 */
function lastWebViewProps(): Record<string, unknown> {
  const last = mockWebViewPropsList[mockWebViewPropsList.length - 1];
  if (last == null) {
    throw new Error('ChatConversationWebView 未渲染');
  }
  return last;
}

function TestHost() {
  const workspaceVfsRef = useRef<VfsFileManagerHandle>(null);
  mockUseChatTabContext.mockReturnValue(
    makeMockContext(workspaceVfsRef) as ReturnType<typeof useChatTabContext>,
  );
  return (
    <ChatConversationPanel
      tokens={tokens}
      visible
      chatSubview="conversation"
      sessionBatch={mockSessionBatch}
      onOpenConversation={mockOpenConversation}
    />
  );
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

// ── 工作区面板跨会话重挂（workspace-stale-on-session-switch 回归锁）─────────
//
// SPA 化（会话列表进同一 WebView 文档）后外层不再随会话强制重挂，VfsFileManager
// 的挂载 key 必须自带 sessionId：浏览位置（currentPath）等面板状态属会话，跨会话
// 复用旧实例会拿新会话 VFS list 旧目录 → 切会话误弹「文件不存在或已被删除」。
// v1.5.30 引入；10-02 的修复曾因未合入 main 丢失（v1.5.30~33 连续带病），
// 此为重做后的回归锁——拔牙验证过：key 去掉 sessionId 即首条用例红。

describe('ChatConversationPanel 工作区面板跨会话重挂', () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    mockConversationPanel = 'workspace';
  });

  afterEach(() => {
    if (tree != null) {
      act(() => {
        tree!.unmount();
      });
    }
    tree = undefined;
  });

  it('sessionId 变化时 VfsFileManager 整实例重挂（mount→unmount→mount）', async () => {
    mockSessionId = 's1';
    await act(async () => {
      tree = TestRenderer.create(<TestHost />);
      await flushPromises();
    });
    expect(mockVfsLifecycle).toEqual(['mount']);

    mockSessionId = 's2';
    await act(async () => {
      tree!.update(<TestHost />);
      await flushPromises();
    });
    expect(mockVfsLifecycle).toEqual(['mount', 'unmount', 'mount']);
  });

  it('同一会话内重渲染（chat ↔ workspace 切换）不重挂', async () => {
    mockSessionId = 's1';
    await act(async () => {
      tree = TestRenderer.create(<TestHost />);
      await flushPromises();
    });
    expect(mockVfsLifecycle).toEqual(['mount']);

    mockConversationPanel = 'chat';
    await act(async () => {
      tree!.update(<TestHost />);
      await flushPromises();
    });
    mockConversationPanel = 'workspace';
    await act(async () => {
      tree!.update(<TestHost />);
      await flushPromises();
    });
    expect(mockVfsLifecycle).toEqual(['mount']);
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
    return (
      <ChatConversationPanel
        tokens={tokens}
        visible
        chatSubview="conversation"
        sessionBatch={mockSessionBatch}
        onOpenConversation={mockOpenConversation}
      />
    );
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

  it('验收a（条目4/11）：none 态点 agent 卡直接打开 picker，不弹重选 toast', async () => {
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
    // badge 已提示已删，点击只开 picker、不弹「请重新选择」toast
    expect(mockShowToast).not.toHaveBeenCalled();
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

// ── viewState 下发（第二阶段 wave-2）────────────────────────────────────────
//
// `chatSubview` → 统一宿主的 `view` prop（宿主再经 postToWeb 下发
// `{type:'viewState', payload:{view}}`，web 据此切 `data-view`）。
// 断言面落在**这层映射**：映射错了 web 就一直停在首帧的 conversation 视图
// ——冷启动直接进列表的用户看到的是一张空白的对话页，且没有任何报错。

describe('ChatConversationPanel · viewState 映射（chatSubview → view）', () => {
  /** 子视图由用例驱动（面板真源就是它，props 进来）。 */
  let mockChatSubview: 'sessions' | 'conversation';
  let tree: TestRenderer.ReactTestRenderer | undefined;

  function SubviewTestHost() {
    const workspaceVfsRef = useRef<VfsFileManagerHandle>(null);
    mockUseChatTabContext.mockReturnValue(
      makeMockContext(workspaceVfsRef) as ReturnType<typeof useChatTabContext>,
    );
    return (
      <ChatConversationPanel
        tokens={tokens}
        visible
        chatSubview={mockChatSubview}
        sessionBatch={mockSessionBatch}
        onOpenConversation={mockOpenConversation}
      />
    );
  }

  beforeEach(() => {
    mockChatSubview = 'sessions';
  });

  afterEach(() => {
    if (tree != null) {
      act(() => {
        tree!.unmount();
      });
    }
    tree = undefined;
  });

  it("chatSubview='sessions' → view=list（冷启动列表视图）", async () => {
    await act(async () => {
      tree = TestRenderer.create(<SubviewTestHost />);
      await flushPromises();
    });
    expect(lastWebViewProps().view).toBe('list');
  });

  it("chatSubview='conversation' → view=conversation（且切回 list 会再变一次）", async () => {
    mockChatSubview = 'conversation';
    await act(async () => {
      tree = TestRenderer.create(<SubviewTestHost />);
      await flushPromises();
    });
    expect(lastWebViewProps().view).toBe('conversation');

    // 返回键回到列表：view 必须跟着变（漏了这个就是「返回键点了没反应」）
    mockChatSubview = 'sessions';
    await act(async () => {
      tree!.update(<SubviewTestHost />);
      await flushPromises();
    });
    expect(lastWebViewProps().view).toBe('list');
  });

  it('列表视图下即便没选中会话也挂载宿主（列表本体就在这个 WebView 里）', async () => {
    // 「一个会话都没选中」时 ctx.sessionId 为空——若此时不挂 WebView，
    // 冷启动（默认就停在列表视图）用户看到的就是一片空白。
    mockChatSubview = 'sessions';
    function NoSessionTestHost() {
      const workspaceVfsRef = useRef<VfsFileManagerHandle>(null);
      const ctx = makeMockContext(workspaceVfsRef) as ReturnType<
        typeof useChatTabContext
      >;
      (ctx as {sessionId: string | undefined}).sessionId = undefined;
      // chatScrollKey 是 useChatTabScrollCache 由 projectId+sessionId 派生的，
      // 面板拿不到那两个 null 就拿不到它——这里照真实链路一并置空。
      (ctx as {chatScrollKey: string | null}).chatScrollKey = null;
      mockUseChatTabContext.mockReturnValue(ctx);
      return (
        <ChatConversationPanel
          tokens={tokens}
          visible
          chatSubview="sessions"
          sessionBatch={mockSessionBatch}
          onOpenConversation={mockOpenConversation}
        />
      );
    }
    await act(async () => {
      tree = TestRenderer.create(<NoSessionTestHost />);
      await flushPromises();
    });
    expect(lastWebViewProps().view).toBe('list');
    expect(lastWebViewProps().sessionKey).toBe('no-session');
  });

  it('列表快照：列表视图下发载荷，对话视图传 null（攒着不跨桥）', async () => {
    // 载荷真源的判据在 useSessionListBridge（独立 hook 有自己的单测面）；
    // 这里钉住面板这侧的契约：对话视图必须传 null，否则对话期间列表数据每变
    // 一次就跨一次桥（也正是「仅 list 态推」的实现点）。
    mockChatSubview = 'conversation';
    await act(async () => {
      tree = TestRenderer.create(<SubviewTestHost />);
      await flushPromises();
    });
    expect(lastWebViewProps().sessionList).toBeNull();

    mockChatSubview = 'sessions';
    await act(async () => {
      tree!.update(<SubviewTestHost />);
      await flushPromises();
    });
    // 本用例的 scope.sessions 是空数组：非 null 即为「已在推列表视图载荷」
    expect(lastWebViewProps().sessionList).toEqual({sessions: []});
  });

  it('「工作区面板开着 + 切回列表视图」时 WebView 容器不得被收起', async () => {
    // 这条路真实存在：删掉当前会话时 `handleDeleteSession` 会
    // `setChatSubview('sessions')`，而 `conversationPanel` 还停在 'workspace'。
    // 若对话面容器按 conversationPanel 一刀切 display:none，WebView（= 列表的
    // 载体）就被藏起来了，用户看到的是一片空白列表。
    mockChatSubview = 'sessions';
    mockConversationPanel = 'workspace';
    function WorkspaceThenListTestHost() {
      const workspaceVfsRef = useRef<VfsFileManagerHandle>(null);
      mockUseChatTabContext.mockReturnValue(
        makeMockContext(workspaceVfsRef) as ReturnType<typeof useChatTabContext>,
      );
      return (
        <ChatConversationPanel
          tokens={tokens}
          visible
          chatSubview="sessions"
          sessionBatch={mockSessionBatch}
          onOpenConversation={mockOpenConversation}
        />
      );
    }
    await act(async () => {
      tree = TestRenderer.create(<WorkspaceThenListTestHost />);
      await flushPromises();
    });
    // chatPanel 容器有唯一指纹 backgroundColor:'transparent'
    const chatPanels = tree!.root.findAll(node => {
      const style = node.props?.style;
      return (
        Array.isArray(style) &&
        style.some(
          (item: Record<string, unknown>) =>
            item != null && item.backgroundColor === 'transparent',
        )
      );
    });
    expect(chatPanels.length).toBeGreaterThan(0);
    for (const panel of chatPanels) {
      expect(panel.props.style).not.toContainEqual(
        expect.objectContaining({display: 'none'}),
      );
    }
  });
});

// ── manager 通知的无效全量重推去重（cr2-fix-spec cr2-E-3）──────────────────
//
// 两个徽标集合合挂在同一个 `subscribe` 通知上（受理 / 收尾 / 替换 / 水合都
// 触发），而一次通知里两个集合**常常都没变**。sync() 原先无条件
// `setState(new Set(...))`——引用必变，链条一路放行：`sessionListPayload`
// 的 useMemo 依赖变了 → 重算出新对象 → 宿主比较器是引用比较、判「变了」→
// 列表态全量重推一次。内容一模一样，web 侧却要整批重建 DOM。
//
// 观测面是 `sessionList` **prop 的引用**（本文件的 ChatConversationWebView 是
// jest.mock 哑组件，只抓 props 不消费），不是 postToWeb 计数——真要数下发
// 得去 chat-conversation-webview.test.tsx，那边已被别的节点占了。
describe('ChatConversationPanel · manager 通知去重（cr2-E-3）', () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;

  /** 列表态宿主；scope 带一条会话，好让 `active` 徽标有观测面。 */
  function ListSubviewTestHost() {
    const workspaceVfsRef = useRef<VfsFileManagerHandle>(null);
    const ctx = makeMockContext(workspaceVfsRef) as ReturnType<
      typeof useChatTabContext
    >;
    ctx.scope.sessions = [
      {id: 's1', title: 'S1', updatedAtMs: 1},
    ] as typeof ctx.scope.sessions;
    mockUseChatTabContext.mockReturnValue(ctx);
    return (
      <ChatConversationPanel
        tokens={tokens}
        visible
        chatSubview="sessions"
        sessionBatch={mockSessionBatch}
        onOpenConversation={mockOpenConversation}
      />
    );
  }

  /**
   * `sessionList` prop 的**引用变化次数**（相邻两次渲染比对）。
   *
   * 刻意数「引用变了」而不是「渲染了几次」：面板还有 controller 等一堆异步态，
   * 无关重渲会让渲染计数虚高；引用没变就等于宿主那次下发被挡住了，这才是
   * 这条判路要保的东西。
   */
  function sessionListRefChangeCount(): number {
    let changes = 0;
    for (let i = 1; i < mockWebViewPropsList.length; i += 1) {
      if (
        mockWebViewPropsList[i].sessionList !==
        mockWebViewPropsList[i - 1].sessionList
      ) {
        changes += 1;
      }
    }
    return changes;
  }

  /** 手动发一次 manager 通知（全部已捕获的 listener 都叫一遍）。 */
  async function notifyManager(): Promise<void> {
    await act(async () => {
      for (const listener of mockListListeners) {
        listener();
      }
      await flushPromises();
    });
  }

  afterEach(() => {
    if (tree != null) {
      act(() => {
        tree!.unmount();
      });
    }
    tree = undefined;
  });

  it('列表态连续两次同内容 manager 通知 → sessionList 引用只变化一次', async () => {
    await act(async () => {
      tree = TestRenderer.create(<ListSubviewTestHost />);
      await flushPromises();
    });
    // 订阅确实挂上了，否则下面的通知是空转、断言会假绿
    expect(mockListListeners.length).toBeGreaterThan(0);
    const baseline = sessionListRefChangeCount();
    // 初始无活跃 run：徽标应为 false（此时载荷引用已在 baseline 里定型）
    expect(lastWebViewProps().sessionList).toEqual({
      sessions: [
        {
          id: 's1',
          title: 'S1',
          updatedAtMs: 1,
          active: false,
          interrupted: false,
          current: true,
        },
      ],
    });

    // 第一次通知：内容真变了（无活跃 → s1 在跑），徽标该刷新、载荷该换引用
    mockListManager.activeSessionIds.mockReturnValue(['s1']);
    await notifyManager();
    expect(lastWebViewProps().sessionList).toEqual({
      sessions: [
        {
          id: 's1',
          title: 'S1',
          updatedAtMs: 1,
          active: true,
          interrupted: false,
          current: true,
        },
      ],
    });
    const afterFirst = lastWebViewProps().sessionList;
    expect(sessionListRefChangeCount() - baseline).toBe(1);

    // 第二次通知：**同内容**。同步判等后不得再换引用，否则就是一次白推的全量重推
    await notifyManager();
    // 验收口径（cr2-E-3）：两次同内容通知合起来只准让载荷引用变化 **+1** 次
    expect(sessionListRefChangeCount() - baseline).toBe(1);
    expect(lastWebViewProps().sessionList).toBe(afterFirst);
  });

  it('内容真变的通知照样放行（去重不能把徽标刷新一起挡掉）', async () => {
    await act(async () => {
      tree = TestRenderer.create(<ListSubviewTestHost />);
      await flushPromises();
    });
    const baseline = sessionListRefChangeCount();

    // ① 活跃：0 → 1 条
    mockListManager.activeSessionIds.mockReturnValue(['s1']);
    await notifyManager();
    // ② 中断：新出现的另一条集合内容
    mockListManager.interruptedSessionIds.mockReturnValue(new Set(['s1']));
    await notifyManager();
    // ③ 再撤掉活跃（收尾）
    mockListManager.activeSessionIds.mockReturnValue([]);
    await notifyManager();

    // 三次都是真变化 → 三次都该重算载荷
    expect(sessionListRefChangeCount() - baseline).toBe(3);
    const list = lastWebViewProps().sessionList as {sessions: Array<Record<string, unknown>>};
    expect(list.sessions[0]).toMatchObject({active: false, interrupted: true});
  });
});

// ── sameStringSet 纯函数（cr2-E-3 的判路本体）──────────────────────────────
describe('sameStringSet（内容级判等）', () => {
  it('同内容不同引用判等；size 或成员有别即判不等', () => {
    expect(sameStringSet(new Set(['a']), new Set(['a']))).toBe(true);
    expect(sameStringSet(new Set(), new Set())).toBe(true);
    // 内容相同但顺序不同 → 仍是等（集合无序，不能按迭代顺序比）
    expect(sameStringSet(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    // size 相同但成员不同
    expect(sameStringSet(new Set(['a']), new Set(['b']))).toBe(false);
    // size 不同
    expect(sameStringSet(new Set(['a']), new Set(['a', 'b']))).toBe(false);
  });

  it('同一引用短路返回 true', () => {
    const s = new Set(['a']);
    expect(sameStringSet(s, s)).toBe(true);
  });
});
