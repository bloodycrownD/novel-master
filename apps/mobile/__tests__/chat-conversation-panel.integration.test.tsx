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
// 这层 mock 另担两件事：①抓 props（面板→宿主的 props 面回归锁的观察面）；
// ②记 mount/unmount 流水（切会话 key 重挂回归锁的观察面）。
const mockCommitSyntheticAssistantRow = jest.fn(() => true);
const mockWebViewPropsList: Array<Record<string, unknown>> = [];
const mockWebViewLifecycle: string[] = [];
jest.mock('../src/components/chat/ChatConversationWebView', () => {
  const mockReact = require('react');
  return {
    ChatConversationWebView: mockReact.forwardRef(
      (
        props: unknown,
        ref: React.Ref<{commitSyntheticAssistantRow: unknown}>,
      ) => {
        mockWebViewPropsList.push(props as Record<string, unknown>);
        mockReact.useEffect(() => {
          mockWebViewLifecycle.push('mount');
          return () => {
            mockWebViewLifecycle.push('unmount');
          };
        }, []);
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

// 原生输入 dock 的接线观察面（composer-native-2026-10 Step 5）：mock 掉
// NativeChatComposer，①抓 props（面板 → composer 的 props 面回归锁）；
// ②经 ref 暴露可记录的 setText（M7 命令式通道落点的断言面）。组件本体渲染
// null——dock 内部行为（胶囊/粘贴门控）由 native-composer*.test.tsx 覆盖。
const mockComposerSetText = jest.fn();
const mockComposerPropsList: Array<Record<string, unknown>> = [];
jest.mock('../src/components/chat/NativeChatComposer', () => {
  const mockReact = require('react');
  return {
    NativeChatComposer: mockReact.forwardRef(
      (props: unknown, ref: React.Ref<unknown>) => {
        mockComposerPropsList.push(props as Record<string, unknown>);
        mockReact.useImperativeHandle(ref, () => ({
          setText: mockComposerSetText,
          focus: () => undefined,
          blur: () => undefined,
        }));
        return null;
      },
    ),
  };
});
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
// tokens 带 9 键：原生 composer 的 theme props 断言面（conversation-theme 映射）。
jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#000',
      text: '#fff',
      textSecondary: '#ccc',
      primary: '#08f',
      selection: '#08f55',
      danger: '#f55',
      surface: '#111',
      borderLight: '#222',
    },
  }),
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
import {
  applyComposerStatusAttachmentsReplace,
  clearChatComposerDraft,
  readChatComposerDraftState,
} from '../src/storage/chat-composer-draft';
import {serializeComposerDraftJson} from '@novel-master/core/chat';
import {formatStatusChipLabelFromAttachment} from '@novel-master/core/chat';

/**
 * 灌一个够 controller 跑起来的 mock runtime（草稿水化 + 发送决策）。
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
    sessionStreamUnitManager: {
      startRun: jest.fn(async () => ({ok: true})),
      stopRun: jest.fn(),
    },
  });
}

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
// 按用例可变的 ctx 覆盖面（发送分支用例置 hasWorkspaceModel 等；beforeEach 清空）。
let mockContextOverrides: Record<string, unknown> = {};
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
      openSessionFilePreview: jest.fn(),
      openChatLink: jest.fn(),
      openSubagentSession: jest.fn(),
      openSkillDetail: jest.fn(),
    },
    messages: {hydrateFromSessionCache: jest.fn()},
    resetStreamingDisplay: jest.fn(),
    navigation: {} as any,
    showToast: jest.fn(),
    runtime: {sessionStreamUnitManager: {}} as any,
    setCurrentSession: jest.fn(async () => undefined),
    closeMessageMenu: jest.fn(),
    ...mockContextOverrides,
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
  mockWebViewLifecycle.length = 0;
  mockCommitSyntheticAssistantRow.mockClear();
  mockComposerPropsList.length = 0;
  mockComposerSetText.mockClear();
  mockContextOverrides = {};
});

/** 取最近一次渲染时统一宿主收到的 props（viewState 断言面）。 */
function lastWebViewProps(): Record<string, unknown> {
  const last = mockWebViewPropsList[mockWebViewPropsList.length - 1];
  if (last == null) {
    throw new Error('ChatConversationWebView 未渲染');
  }
  return last;
}

/** 取最近一次渲染时原生 dock 收到的 props（Step 5 接线断言面）。 */
function lastComposerProps(): Record<string, unknown> {
  const last = mockComposerPropsList[mockComposerPropsList.length - 1];
  if (last == null) {
    throw new Error('NativeChatComposer 未渲染');
  }
  return last;
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

// ── 切会话 key 重挂（回滚 SPA 化的核心命题）──────────────────────────────
//
// 面板不再有 chatSubview / sessionList / viewState 这些列表域 props，也不再有
// sessionBatch / onOpenConversation（会话列表与 ⋮ 菜单整体回迁 ChatSessionListPanel）。
// 切会话改为 `<ChatConversationWebView key={chatScrollKey}>` 销毁重建——文档内状态
// 天然归零，不再需要宿主侧手动清场。
describe('ChatConversationPanel · 切会话 key 重挂', () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;

  /** chatScrollKey 由用例驱动（默认 'p1:s1'，切到 'p1:s2' 模拟换会话）。 */
  let mockChatScrollKey: string | null = 'p1:s1';

  function ScrollKeyTestHost() {
    const workspaceVfsRef = useRef<VfsFileManagerHandle>(null);
    const ctx = makeMockContext(workspaceVfsRef) as unknown as Record<
      string,
      unknown
    >;
    ctx.chatScrollKey = mockChatScrollKey;
    mockUseChatTabContext.mockReturnValue(
      ctx as unknown as ReturnType<typeof useChatTabContext>,
    );
    return <ChatConversationPanel tokens={tokens} visible />;
  }

  beforeEach(() => {
    mockChatScrollKey = 'p1:s1';
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

  it('chatScrollKey 变化 → ChatConversationWebView 整实例重挂（mount→unmount→mount）', async () => {
    await act(async () => {
      tree = TestRenderer.create(<ScrollKeyTestHost />);
      await flushPromises();
    });
    expect(mockWebViewLifecycle).toEqual(['mount']);

    mockChatScrollKey = 'p1:s2';
    await act(async () => {
      tree!.update(<ScrollKeyTestHost />);
      await flushPromises();
    });
    // 拔牙验证：key 从 ChatConversationWebView 上摘掉即红（只剩一次 mount）
    expect(mockWebViewLifecycle).toEqual(['mount', 'unmount', 'mount']);
  });

  it('同一会话内重渲染不重挂（key 不变 = 实例恒等）', async () => {
    await act(async () => {
      tree = TestRenderer.create(<ScrollKeyTestHost />);
      await flushPromises();
    });
    expect(mockWebViewLifecycle).toEqual(['mount']);

    mockConversationPanel = 'workspace';
    await act(async () => {
      tree!.update(<ScrollKeyTestHost />);
      await flushPromises();
    });
    mockConversationPanel = 'chat';
    await act(async () => {
      tree!.update(<ScrollKeyTestHost />);
      await flushPromises();
    });
    expect(mockWebViewLifecycle).toEqual(['mount']);
  });

  it('面板 props 面不再有 chatSubview / sessionBatch / onOpenConversation（列表域整体回迁）', async () => {
    // 编译期 + 运行期双锁：TS 侧这些 props 已从 ChatConversationPanelProps
    // 移除（多传一个就红），运行期再钉一次「宿主拿到的 props 里没有它们」。
    await act(async () => {
      tree = TestRenderer.create(<ScrollKeyTestHost />);
      await flushPromises();
    });
    const props = lastWebViewProps();
    expect(props).not.toHaveProperty('chatSubview');
    expect(props).not.toHaveProperty('sessionBatch');
    expect(props).not.toHaveProperty('onOpenConversation');
    // 列表域下发面同样不在了
    expect(props).not.toHaveProperty('view');
    expect(props).not.toHaveProperty('sessionList');
    expect(props).not.toHaveProperty('onListAction');
  });

  it('composer 域 props 不再下发宿主（D4b 剥离；dock 由 Step 5 原生 composer 承接）', async () => {
    // 反面锁：面板保留 controller，但其 composer 域产出不经 props 进转录宿主——
    // 宿主 props 面一旦回潮即红。
    await act(async () => {
      tree = TestRenderer.create(<ScrollKeyTestHost />);
      await flushPromises();
    });
    const props = lastWebViewProps();
    for (const retired of [
      'composerText',
      'composerCursor',
      'onComposerChangeText',
      'onComposerSelectionChange',
      'composerInputDisabled',
      'composerHasModel',
      'composerSendDisabled',
      'composerRunning',
      'composerError',
      'composerFullscreenEnabled',
      'composerPlaceholder',
      'composerChips',
      'composerKeyboardUp',
      'composerTypeahead',
      'safeAreaBottom',
      'onDockAction',
    ]) {
      expect(props).not.toHaveProperty(retired);
    }
    // dock 占位已被原生 composer 替换（Step 5）
    expect(() =>
      tree!.root.findByProps({testID: 'chat-dock-placeholder'}),
    ).toThrow();
    expect(lastComposerProps()).toBeDefined();
  });
});

// ── 原生 dock 接线（composer-native-2026-10 Step 5 · 变更点 #6/#14/D8）───────
//
// 面板把 controller 真源拆字段直连 <NativeChatComposer>。断言面：
// - props 面回归锁（hasModel/canSend/error/chipLabels/keyboardUp/
//   safeAreaBottom/fullscreenEnabled/theme 9 键逐项对照 controller 真源）；
// - dock 上行转发 controller（needModel / send 分支）；
// - 命令式写入通道（M7）落 ref.setText（发送清空 / 草稿水化）；
// - 恢复链并行（D8）：草稿水化不等转录 webview 的 ready 握手——本文件的
//   webview mock 从不触发 onReady，composer 链照常水化即并行成立的直接证据。
describe('ChatConversationPanel · 原生 dock 接线（Step 5）', () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;

  afterEach(() => {
    if (tree != null) {
      act(() => {
        tree!.unmount();
      });
    }
    tree = undefined;
  });

  it('NativeChatComposer 渲染并收到 controller 派生的关键 props', async () => {
    await act(async () => {
      tree = TestRenderer.create(<TestHost />);
      await flushPromises();
    });
    const props = lastComposerProps();
    // 默认 ctx：无模型 → hasModel false、inputDisabled true、canSend false
    expect(props.hasModel).toBe(false);
    expect(props.disabled).toBe(true);
    expect(props.inputDisabled).toBe(true);
    expect(props.canSend).toBe(false);
    expect(props.running).toBe(false);
    expect(props.uiRunning).toBe(false);
    expect(props.error).toBeUndefined();
    expect(props.chipLabels).toEqual([]);
    expect(props.keyboardUp).toBe(false);
    // insets mock bottom=0 → safeAreaBottom 0；TestHost 未注入 ⛶ 回调 → 不可用
    expect(props.safeAreaBottom).toBe(0);
    expect(props.fullscreenEnabled).toBe(false);
    // theme 9 键与转录文档同源（conversation-themeFromTokens 映射）
    expect(props.theme).toEqual({
      background: '#000',
      text: '#fff',
      textSecondary: '#ccc',
      primary: '#08f',
      primaryMuted: '#08f22',
      selection: '#08f55',
      danger: '#f55',
      surface: '#111',
      borderLight: '#222',
    });
  });

  it('onDockAction 转发 controller：needModel 落 ctx.onNeedModel', async () => {
    const onNeedModel = jest.fn();
    mockContextOverrides.onNeedModel = onNeedModel;
    await act(async () => {
      tree = TestRenderer.create(<TestHost />);
      await flushPromises();
    });

    await act(async () => {
      lastComposerProps().onDockAction('needModel');
    });

    expect(onNeedModel).toHaveBeenCalledTimes(1);
  });

  it('onComposerChangeText 直连 controller.onChangeText（打字落草稿 + value 镜像回传）', async () => {
    await act(async () => {
      tree = TestRenderer.create(<TestHost />);
      await flushPromises();
    });

    await act(async () => {
      lastComposerProps().onComposerChangeText('hello');
    });

    expect(readChatComposerDraftState('s1').text).toBe('hello');
    expect(lastComposerProps().value).toBe('hello');
  });

  it('发送分支走 controller：受理后经 M7 通道清空输入框与草稿', async () => {
    const onNeedModel = jest.fn();
    mockContextOverrides.onNeedModel = onNeedModel;
    mockContextOverrides.hasWorkspaceModel = true;
    // startRun mock 受理即回调 onUserMessageAppended（真机上是 append 落库后）
    const startRun = jest.fn(async (...args: unknown[]) => {
      (args[3] as {onUserMessageAppended?: () => void})
        .onUserMessageAppended?.();
      return {ok: true};
    });
    mockRuntime.sessionStreamUnitManager.startRun = startRun;

    await act(async () => {
      tree = TestRenderer.create(<TestHost />);
      await flushPromises();
    });

    await act(async () => {
      lastComposerProps().onComposerChangeText('你好');
    });
    // 有正文 → 发送钮可用（canSend = !sendDisabled，resolveComposerSendIntent 语义）
    expect(lastComposerProps().canSend).toBe(true);

    await act(async () => {
      await lastComposerProps().onDockAction('send');
      await flushPromises();
    });

    expect(startRun).toHaveBeenCalledTimes(1);
    expect(onNeedModel).not.toHaveBeenCalled();
    // 清空走 M7 命令式通道（clearComposerNow → ref.setText('', 0)）；面板
    // 回调恒三参透传（D4），未给 ranges 时第三参为 undefined。
    expect(mockComposerSetText).toHaveBeenCalledWith('', 0, undefined);
    expect(readChatComposerDraftState('s1').text).toBe('');
  });

  it('chipLabels 由状态条附件经 core formatStatusChipLabelFromAttachment 派生', async () => {
    await act(async () => {
      tree = TestRenderer.create(<TestHost />);
      await flushPromises();
    });

    const attachment = {
      id: 'c1',
      source: 'workplace',
      action: 'read',
      label: '工作区文件',
    } as never;
    await act(async () => {
      applyComposerStatusAttachmentsReplace({
        sessionId: 's1',
        attachments: [attachment],
      });
      await flushPromises();
    });

    expect(lastComposerProps().chipLabels).toEqual([
      formatStatusChipLabelFromAttachment(attachment),
    ]);
  });

  it('恢复链并行（D8）：草稿水化经 ref.setText 进框，不等转录 webview ready', async () => {
    // DB 侧预置草稿：水化链读到后经 syncFromDraft → 命令式通道进框。
    // 本文件的 ChatConversationWebView mock 从不触发 onReady（webview 链永未
    // ready），composer 链照常完成水化——两链并行、无握手依赖的直接证据。
    mockRuntime.sessions.getComposerDraftJson = jest.fn(async () =>
      serializeComposerDraftJson({text: '草稿正文', attachments: []}),
    );

    await act(async () => {
      tree = TestRenderer.create(<TestHost />);
      await flushPromises();
    });

    expect(mockComposerSetText).toHaveBeenCalledTimes(1);
    // D4 三参：无 ranges 的草稿经兜底扫描得到 `[]`，第三参必须是这份数组
    // （不是 undefined——undefined 会让组件走 remap 旧路径）。
    expect(mockComposerSetText).toHaveBeenCalledWith('草稿正文', undefined, []);
    // value 镜像同步（面板声明式面也拿到草稿明文）
    expect(lastComposerProps().value).toBe('草稿正文');
  });

  it('T-CA6 水化三参：带持久化 tokenRanges 的草稿 → setText 第三参为持久化值', async () => {
    // 真实下发路径断言（R2 P0-2）：面板 → controller.syncFromDraft → 面板
    // setComposerText → composerRef.setText。controller spy 注入自己的 spy 会
    // 绕过面板箭头、抓不到丢参缺陷，所以必须在这里断言。
    mockRuntime.sessions.getComposerDraftJson = jest.fn(async () =>
      serializeComposerDraftJson({
        text: '$技能$尾追',
        attachments: [],
        tokenRanges: [{start: 0, end: 4}],
      }),
    );

    await act(async () => {
      tree = TestRenderer.create(<TestHost />);
      await flushPromises();
    });

    expect(mockComposerSetText).toHaveBeenCalledTimes(1);
    expect(mockComposerSetText).toHaveBeenCalledWith(
      '$技能$尾追',
      undefined,
      [{start: 0, end: 4}],
    );
    // 确认态同样进 prop 面（composer 的 tokenRanges = 持久化值，不是兜底扫描
    // 出来的结果——尾追不升格）。
    expect(lastComposerProps().tokenRanges).toEqual([{start: 0, end: 4}]);
  });

  it('F-A5 自愈：持久化旧格式区间（`$技能尾追` + [{0,3}]）→ 丢弃并写回 []', async () => {
    const draftWrite = jest.fn(async () => undefined);
    mockRuntime.sessions.setComposerDraftJson = draftWrite;
    mockRuntime.sessions.getComposerDraftJson = jest.fn(async () =>
      serializeComposerDraftJson({
        text: '$技能尾追',
        attachments: [],
        tokenRanges: [{start: 0, end: 3}],
      }),
    );

    await act(async () => {
      tree = TestRenderer.create(<TestHost />);
      await flushPromises();
    });

    // 首帧就下发过滤后的空区间（不是 [{0,3}] 那枚错区间）
    expect(mockComposerSetText).toHaveBeenCalledWith(
      '$技能尾追',
      undefined,
      [],
    );
    expect(lastComposerProps().tokenRanges).toEqual([]);
    // 并且过滤结果写回草稿，坏区间不会在 store 里永久循环
    const writtenJson = draftWrite.mock.calls.at(-1)?.[1] as
      | string
      | null
      | undefined;
    expect(writtenJson).toBeTruthy();
    expect(JSON.parse(writtenJson as string).tokenRanges).toEqual([]);
  });
});
