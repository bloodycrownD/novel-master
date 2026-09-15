/**
 * Chat tab 组合层 Context：收敛对话子树状态与低频回调。
 *
 * Step 6 起屏幕退化为单元投影的订阅者：本 Provider 不再装配任何运行态
 * （流式缓冲/中止状态机/生命周期/重进注入/探针均由 SessionStreamUnitManager
 * 的 per-session 单元承担），只负责——
 * - 订阅 manager 投影（subscribe + sync 模式）并把当前会话的
 *   SessionStreamUnitView 放进 ctx（运行态的唯一出口，消费方自行派生）；
 * - 会话/引擎/子页变化时把 webview 句柄 attach/detach 进 manager（流式
 *   推送与控制消息广播的接线面）；
 * - 消息面（Step 7 收口）：单一来源 manager——有单元走投影、无单元走
 *   manager 的 idle 消息路径，Provider 不再持有消息 state；
 * - 非运行态（draftRestoreToken / DeviceEventEmitter 监听）继续由
 *   useChatTabMessages 承担（数据管线已退役）。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {type ChatMessage} from '@novel-master/core/chat';
import type {VfsService} from '@novel-master/core/vfs';
import type {WorkplaceService} from '@novel-master/core/workplace';
import type {ChatTranscriptWebViewHandle} from '@/components/chat/ChatTranscriptWebView';
import type {MessageMenuAnchor} from '@/components/chat/MessageActionMenu';
import type {VfsFileManagerHandle} from '@/components/vfs/VfsFileManager';
import type {ChatListScrollSnapshot} from '@/services/chat-list-scroll-cache';
import type {ChatTranscriptScrollSnapshot} from '@/components/chat/ChatTranscriptBridge';
import type {ChatAgentMeta} from '@/services/chat-agent-meta';
import type {SessionStreamUnitView} from '@/services/session-stream-unit';
import {createTranscriptStreamHandle} from '@/services/session-stream-webview-adapter';
import {findLastVisibleMessage} from '@/components/chat/composer-send-state';
import {deriveComposerSendState} from '@/components/chat/composer-send-state';
import {useToast} from '@/components/chrome/ToastHost';
import {useRuntime} from '@/hooks/useRuntime';
import {useMobileScope} from '@/hooks/useMobileScope';
import {useDismissOverlaysOnBlur} from '@/hooks/useDismissOverlaysOnBlur';
import {useNovelMaster} from '@/runtime/novel-master-context';
import {
  isMobileAgentActive,
  subscribeMobileAgentActivity,
} from '@/runtime/agent-activity';
import type {RootStackParamList} from '@/navigation/types';
import {
  defaultChatTranscriptEngine,
  readChatTranscriptEngine,
  type ChatTranscriptEngine,
} from '@/storage/chat-transcript-engine';
import {readChatRichTextEnabled} from '@/storage/chat-rich-text-pref';
import {useChatTabMessages} from './useChatTabMessages';
import {
  useChatTabScope,
  type ChatSubview,
  type ConversationPanel,
} from './useChatTabScope';
import {useChatTabScrollCache} from './useChatTabStream';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** 主会话 webview 句柄在单元注册表里的稳定标识（attach/detach 对账用）。 */
const CHAT_TAB_TRANSCRIPT_HANDLE_ID = 'chat-tab-transcript';

export type ChatTabContextValue = {
  readonly tokens?: never;
  readonly projectId: string | undefined;
  readonly sessionId: string | undefined;
  readonly conversationPanel: ConversationPanel;
  readonly setConversationPanel: (panel: ConversationPanel) => void;
  readonly chatSubview: ChatSubview;
  readonly setChatSubview: (subview: ChatSubview) => void;
  readonly agentMeta: ChatAgentMeta;
  /**
   * 当前会话的单元投影（运行态唯一事实源）：水合未完成或无单元为 null。
   * 消费方自行派生（运行中 = status 为 starting|running；流式 partial =
   * partialText/partialThinking；任务卡 pending 映射 = pendingChildrenByTitle）。
   */
  readonly unitView: SessionStreamUnitView | null;
  /** 全局任意会话运行中（refcount 视图）。 */
  readonly agentActive: boolean;
  readonly chatMessages: readonly ChatMessage[];
  readonly hasMoreMessages: boolean;
  readonly loadingMoreMessages: boolean;
  readonly onMessagesChanged: (options?: {immediate?: boolean}) => void;
  readonly canResumeWithoutInput: boolean;
  readonly lastMessageIsPlainUserText: boolean;
  readonly draftRestoreToken: number;
  readonly sessionVfs: VfsService | null;
  readonly sessionWorktree: WorkplaceService | null;
  readonly vfsRefreshKey: number;
  readonly hasWorkspaceModel: boolean;
  readonly bumpWorktreeUiToken: () => void;
  readonly chatScrollKey: string | null;
  readonly cachedChatScroll:
    | ChatListScrollSnapshot
    | ChatTranscriptScrollSnapshot
    | undefined;
  readonly restoredTranscriptScroll: ChatTranscriptScrollSnapshot | undefined;
  readonly defaultChatScrollToBottom: boolean;
  readonly onChatScrollSnapshot: (
    snap: ChatListScrollSnapshot | ChatTranscriptScrollSnapshot,
  ) => void;
  readonly sessionDrawerOpen: boolean;
  readonly setSessionDrawerOpen: (open: boolean) => void;
  readonly modelPickerOpen: boolean;
  readonly setModelPickerOpen: (open: boolean) => void;
  readonly agentPickerOpen: boolean;
  readonly setAgentPickerOpen: (open: boolean) => void;
  readonly messageMenuTarget: ChatMessage | undefined;
  readonly messageMenuAnchor: MessageMenuAnchor | undefined;
  readonly setMessageMenuTarget: (msg: ChatMessage | undefined) => void;
  readonly setMessageMenuAnchor: (
    anchor: MessageMenuAnchor | undefined,
  ) => void;
  readonly messageEditPrompt:
    | {messageId: string; initialText: string}
    | undefined;
  readonly setMessageEditPrompt: (
    prompt: {messageId: string; initialText: string} | undefined,
  ) => void;
  readonly useWebviewTranscript: boolean;
  readonly chatRichTextEnabled: boolean;
  /**
   * pending task 工具的子会话映射（title → childSessionId）。
   * Step 6 起从当前会话的单元投影读取（pendingChildrenByTitle）——
   * 执行中的 task 卡片可点击进入子会话。
   */
  readonly pendingSubagentSessions: ReadonlyMap<string, string>;
  readonly richRenderEpoch: number;
  readonly webMenuCloseSignal: number;
  readonly webMenuOpen: boolean;
  readonly setWebMenuOpen: (open: boolean) => void;
  /** mermaid 全屏查看器开着（WebView 上浮；Android 返回键据此先关全屏）。 */
  readonly mermaidViewerOpen: boolean;
  readonly setMermaidViewerOpen: (open: boolean) => void;
  /** 递增时由 ChatTranscriptWebView 下发 closeMermaidViewer（照 webMenuCloseSignal 先例）。 */
  readonly mermaidViewerCloseSignal: number;
  /** WebView onReady 接线：bump ready 世代，驱动句柄 attach 进 manager。 */
  readonly onTranscriptWebviewReady: () => void;
  /**
   * WebView ready 世代（每次 onReady 递增，0 = 尚未 ready）：除句柄 attach
   * 外，也是「ready 前到达的投影动作」的补交驱动（如中断现场合成行提交
   * useInterruptedPartialCommit——ui/B-1 的 tail 先于 ready 时序）。
   */
  readonly transcriptReadyEpoch: number;
  readonly onLoadOlderMessages: () => void;
  readonly onOpenFileEditor: (
    path: string,
    scopeKind: 'project' | 'session',
  ) => void;
  readonly onNeedModel: () => void;
  readonly onRefreshChatMeta: () => void;
  readonly transcriptWebRef: React.RefObject<ChatTranscriptWebViewHandle | null>;
  readonly workspaceVfsRef: React.RefObject<VfsFileManagerHandle | null>;
  readonly scope: ReturnType<typeof useChatTabScope>;
  readonly messages: ReturnType<typeof useChatTabMessages>;
  readonly navigation: Nav;
  readonly showToast: (message: string) => void;
  readonly runtime: ReturnType<typeof useRuntime>;
  readonly setCurrentSession: (sessionId: string) => Promise<void>;
  readonly closeMessageMenu: () => void;
  /** 返回键关闭 mermaid 全屏查看器：复位拦截态并递增下发信号。 */
  readonly closeMermaidViewer: () => void;
};

const ChatTabCtx = createContext<ChatTabContextValue | null>(null);

export function useChatTabContext(): ChatTabContextValue {
  const ctx = useContext(ChatTabCtx);
  if (ctx == null) {
    throw new Error('useChatTabContext 须在 ChatTabProvider 内使用');
  }
  return ctx;
}

export function ChatTabProvider({children}: {children: ReactNode}) {
  const {showToast} = useToast();
  const runtime = useRuntime();
  const {
    projectId,
    sessionId,
    setCurrentProject,
    setCurrentSession,
    refreshScope,
  } = useMobileScope();
  const navigation = useNavigation<Nav>();
  const {appUi, richRenderEpoch} = useNovelMaster();

  const scope = useChatTabScope({
    runtime,
    projectId,
    sessionId,
    setCurrentProject,
    setCurrentSession,
    refreshScope,
    showToast,
    navigation,
  });

  const messages = useChatTabMessages({
    sessionId,
    onTranscriptChanged: scope.refreshChatTokenLabel,
  });

  const {refreshChatMeta} = scope;
  useEffect(() => {
    if (scope.chatSubview === 'conversation' && sessionId != null) {
      refreshChatMeta().catch(() => undefined);
    }
  }, [scope.chatSubview, sessionId, refreshChatMeta]);

  const manager = runtime.sessionStreamUnitManager;

  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const transcriptWebRef = useRef<ChatTranscriptWebViewHandle>(null);
  const workspaceVfsRef = useRef<VfsFileManagerHandle>(null);
  const [chatRichTextEnabled, setChatRichTextEnabled] = useState(false);
  const [messageMenuTarget, setMessageMenuTarget] = useState<
    ChatMessage | undefined
  >();
  const [messageMenuAnchor, setMessageMenuAnchor] = useState<
    MessageMenuAnchor | undefined
  >();
  const [webMenuOpen, setWebMenuOpen] = useState(false);
  const [webMenuCloseSignal, setWebMenuCloseSignal] = useState(0);
  const [mermaidViewerOpen, setMermaidViewerOpen] = useState(false);
  const [mermaidViewerCloseSignal, setMermaidViewerCloseSignal] = useState(0);
  const [messageEditPrompt, setMessageEditPrompt] = useState<
    {messageId: string; initialText: string} | undefined
  >();
  const [chatTranscriptEngine, setChatTranscriptEngine] =
    useState<ChatTranscriptEngine>(defaultChatTranscriptEngine);

  const useWebviewTranscript = chatTranscriptEngine === 'webview';

  const scroll = useChatTabScrollCache({
    projectId,
    sessionId,
    useWebviewTranscript,
  });

  // ===== 单元投影 + 消息面订阅（subscribe + useEffect + sync 模式） =====
  // 当前会话的运行态唯一事实源：水合未完成 / 无单元为 null。事件同步总线
  // 保证 manager 订阅先于 UI 建立——UI 侧同名事件回调执行时投影已更新。
  // 消息面（Step 7 收口）单一来源 manager：readMessagesSnapshot 有单元走
  // 投影、无单元走 idle 视图，Provider 不再持有第二套消息 state。
  const [unitView, setUnitView] = useState<SessionStreamUnitView | null>(
    () => (sessionId != null ? manager.snapshot(sessionId) : null),
  );
  const [messagesView, setMessagesView] = useState<
    ReturnType<typeof manager.readMessagesSnapshot>
  >(() => (sessionId != null ? manager.readMessagesSnapshot(sessionId) : null));
  useEffect(() => {
    const sync = () => {
      setUnitView(sessionId != null ? manager.snapshot(sessionId) : null);
      setMessagesView(
        sessionId != null ? manager.readMessagesSnapshot(sessionId) : null,
      );
    };
    sync();
    return manager.subscribe(sync);
  }, [manager, sessionId]);

  const hasUnit = unitView != null;

  // 消息面 tail 水合：会话切换或单元出现时取 tail（非 force——缓存命中即
  // 采纳的会话切换语义；运行中单元的后续刷新由 step/settle 边界自驱）。
  // 无单元（非运行态会话）同样走 manager 的 idle 路径（Step 7 收口后双源
  // 合一，hook 数据管线已退役）。
  const chatSubview = scope.chatSubview;
  useEffect(() => {
    if (sessionId == null || chatSubview !== 'conversation') {
      return;
    }
    void manager
      .loadSessionTailMessages(sessionId, {projectId})
      .catch(() => undefined);
  }, [manager, sessionId, projectId, chatSubview, hasUnit]);

  // ===== webview 句柄 attach/detach =====
  // webview ready 世代：每次 onReady 递增（重挂/切会话后 webview 是空基线，
  // 句柄必须在 ready 之后挂进单元——注入与流式推送才有落点）。epoch 为 0
  // 表示当前挂载的 webview 尚未 ready，不 attach。
  const [transcriptReadyEpoch, setTranscriptReadyEpoch] = useState(0);
  const onTranscriptWebviewReady = useCallback(() => {
    setTranscriptReadyEpoch(epoch => epoch + 1);
  }, []);

  useEffect(() => {
    if (
      sessionId == null ||
      !useWebviewTranscript ||
      scope.chatSubview !== 'conversation' ||
      transcriptReadyEpoch === 0
    ) {
      return;
    }
    const web = transcriptWebRef.current;
    if (web == null) {
      return;
    }
    const sid = sessionId;
    // 单元流式载荷/控制消息 → webview handle 的适配层（哑引擎契约不动，
    // 映射细节见 services/session-stream-webview-adapter）。
    const handle = createTranscriptStreamHandle(
      CHAT_TAB_TRANSCRIPT_HANDLE_ID,
      web,
    );
    manager.attachWebview(sid, handle);
    return () => {
      manager.detachWebview(sid, handle.handleId);
    };
  }, [
    manager,
    sessionId,
    useWebviewTranscript,
    scope.chatSubview,
    transcriptReadyEpoch,
    hasUnit,
  ]);

  // ===== 消息面（单一来源 manager，Step 7 收口） =====
  // readMessagesSnapshot：有单元（含宽限中的 settled / 水合的 interrupted）
  // 走投影，无单元（非运行态会话）走 idle 视图；单元销毁时 manager 已把
  // 投影消息面交接进 idle，屏幕侧无迁移沿要补偿。
  const chatMessages = useMemo(
    () => messagesView?.messages ?? EMPTY_CHAT_MESSAGES,
    [messagesView],
  );
  const hasMoreMessages = messagesView?.hasMoreMessages ?? false;
  const loadingMoreMessages = messagesView?.loadingMoreMessages ?? false;

  // 发送态推导基于显示源：用户消息 append 后 force 回源刷新（有单元走
  // 投影、无单元走 idle），推导随消息面即时更新。
  const composerSendState = useMemo(
    () => deriveComposerSendState(findLastVisibleMessage(chatMessages)),
    [chatMessages],
  );

  const onLoadOlderMessages = useCallback(() => {
    if (sessionId != null) {
      void manager
        .loadOlderSessionMessages(sessionId, projectId)
        .catch(() => undefined);
    }
  }, [manager, sessionId, projectId]);

  // composer 的 onUserMessageAppended / onSettled 回调驱动：force 回源刷新
  // 消息面（用户消息行进基线；低频调用不合并）+ 刷新 token 讇签。
  const refreshChatTokenLabel = scope.refreshChatTokenLabel;
  const handleMessagesChanged = useCallback(
    (options?: {immediate?: boolean}) => {
      void (async () => {
        if (sessionId != null) {
          try {
            await manager.loadSessionTailMessages(sessionId, {
              force: true,
              projectId,
            });
          } catch {
            // DB 失败不阻塞 token 标签刷新
          }
        }
        void refreshChatTokenLabel().catch(() => undefined);
      })();
    },
    [manager, sessionId, projectId, refreshChatTokenLabel],
  );

  const [agentActive, setAgentActive] = useState(() => isMobileAgentActive());
  useEffect(() => subscribeMobileAgentActivity(setAgentActive), []);

  const {
    setProjectDrawerOpen,
    setSessionDrawerOpen,
    setSessionRenamePrompt,
    setMenuSessionId,
  } = scope;

  const closeMessageMenu = useCallback(() => {
    setMessageMenuTarget(undefined);
    setMessageMenuAnchor(undefined);
    setWebMenuOpen(false);
    setWebMenuCloseSignal(signal => signal + 1);
  }, []);

  const closeMermaidViewer = useCallback(() => {
    setMermaidViewerOpen(false);
    setMermaidViewerCloseSignal(signal => signal + 1);
  }, []);

  const dismissAllOverlays = useCallback(() => {
    setProjectDrawerOpen(false);
    setSessionDrawerOpen(false);
    setModelPickerOpen(false);
    setAgentPickerOpen(false);
    closeMessageMenu();
    closeMermaidViewer();
    setMessageEditPrompt(undefined);
    setSessionRenamePrompt(undefined);
    setMenuSessionId(undefined);
  }, [
    closeMessageMenu,
    closeMermaidViewer,
    setProjectDrawerOpen,
    setSessionDrawerOpen,
    setSessionRenamePrompt,
    setMenuSessionId,
  ]);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  const refreshChatRichTextPref = useCallback(async () => {
    if (appUi == null) {
      return;
    }
    setChatRichTextEnabled(await readChatRichTextEnabled(appUi));
  }, [appUi]);

  const refreshChatTranscriptEngine = useCallback(async () => {
    setChatTranscriptEngine(await readChatTranscriptEngine(appUi));
  }, [appUi]);

  useFocusEffect(
    useCallback(() => {
      refreshChatRichTextPref().catch(() => undefined);
      refreshChatTranscriptEngine().catch(() => undefined);
      refreshChatMeta().catch(() => undefined);
    }, [
      refreshChatRichTextPref,
      refreshChatTranscriptEngine,
      refreshChatMeta,
    ]),
  );

  const value = useMemo(
    (): ChatTabContextValue => ({
      projectId,
      sessionId,
      conversationPanel: scope.conversationPanel,
      setConversationPanel: scope.setConversationPanel,
      chatSubview: scope.chatSubview,
      setChatSubview: scope.setChatSubview,
      agentMeta: scope.agentMeta,
      unitView,
      agentActive,
      chatMessages,
      hasMoreMessages,
      loadingMoreMessages,
      onMessagesChanged: handleMessagesChanged,
      canResumeWithoutInput: composerSendState.canResumeWithoutInput,
      lastMessageIsPlainUserText:
        composerSendState.lastMessageIsPlainUserText,
      draftRestoreToken: messages.draftRestoreToken,
      sessionVfs: scope.sessionVfs,
      sessionWorktree: scope.sessionWorktree,
      vfsRefreshKey: scope.vfsRefreshKey,
      hasWorkspaceModel: scope.hasWorkspaceModel,
      bumpWorktreeUiToken: scope.bumpWorktreeUiToken,
      chatScrollKey: scroll.chatScrollKey,
      cachedChatScroll: scroll.cachedChatScroll,
      restoredTranscriptScroll: scroll.restoredTranscriptScroll,
      defaultChatScrollToBottom: scroll.defaultChatScrollToBottom,
      onChatScrollSnapshot: scroll.handleChatScrollSnapshot,
      sessionDrawerOpen: scope.sessionDrawerOpen,
      setSessionDrawerOpen: scope.setSessionDrawerOpen,
      modelPickerOpen,
      setModelPickerOpen,
      agentPickerOpen,
      setAgentPickerOpen,
      messageMenuTarget,
      messageMenuAnchor,
      setMessageMenuTarget,
      setMessageMenuAnchor,
      messageEditPrompt,
      setMessageEditPrompt,
      useWebviewTranscript,
      chatRichTextEnabled,
      pendingSubagentSessions:
        unitView?.pendingChildrenByTitle ?? EMPTY_PENDING_SUBAGENT_SESSIONS,
      richRenderEpoch,
      webMenuCloseSignal,
      webMenuOpen,
      setWebMenuOpen,
      mermaidViewerOpen,
      setMermaidViewerOpen,
      mermaidViewerCloseSignal,
      onTranscriptWebviewReady,
      transcriptReadyEpoch,
      onLoadOlderMessages,
      onOpenFileEditor: scope.openFileEditor,
      onNeedModel: () => setModelPickerOpen(true),
      onRefreshChatMeta: () => scope.refreshChatMeta().catch(() => undefined),
      transcriptWebRef,
      workspaceVfsRef,
      scope,
      messages,
      navigation,
      showToast,
      runtime,
      setCurrentSession,
      closeMessageMenu,
      closeMermaidViewer,
    }),
    [
      projectId,
      sessionId,
      scope,
      unitView,
      agentActive,
      chatMessages,
      hasMoreMessages,
      loadingMoreMessages,
      handleMessagesChanged,
      composerSendState,
      messages,
      scroll,
      modelPickerOpen,
      agentPickerOpen,
      messageMenuTarget,
      messageMenuAnchor,
      messageEditPrompt,
      useWebviewTranscript,
      chatRichTextEnabled,
      richRenderEpoch,
      webMenuCloseSignal,
      webMenuOpen,
      mermaidViewerOpen,
      mermaidViewerCloseSignal,
      onTranscriptWebviewReady,
      transcriptReadyEpoch,
      onLoadOlderMessages,
      navigation,
      showToast,
      runtime,
      setCurrentSession,
      closeMessageMenu,
      closeMermaidViewer,
    ],
  );

  return <ChatTabCtx.Provider value={value}>{children}</ChatTabCtx.Provider>;
}

const EMPTY_PENDING_SUBAGENT_SESSIONS: ReadonlyMap<string, string> = new Map();

const EMPTY_CHAT_MESSAGES: readonly ChatMessage[] = [];
