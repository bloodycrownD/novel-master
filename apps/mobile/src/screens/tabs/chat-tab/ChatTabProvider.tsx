/**
 * Chat tab 组合层 Context：收敛对话子树状态与高频回调。
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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { type ChatMessage } from '@novel-master/core/chat';
import type { VfsService } from '@novel-master/core/vfs';
import type { WorkplaceService } from '@novel-master/core/workplace';
import {
  EVENT_SUBAGENT_CHILD_SESSION_CREATED,
  type SubagentChildSessionCreatedPayload,
} from '@novel-master/core/events';
import type { ChatTranscriptWebViewHandle } from '@/components/chat/ChatTranscriptWebView';
import type { StreamWireChunk } from '@/services/stream-wire-queue';
import type { MessageMenuAnchor } from '@/components/chat/MessageActionMenu';
import type { VfsFileManagerHandle } from '@/components/vfs/VfsFileManager';
import type { ChatListScrollSnapshot } from '@/services/chat-list-scroll-cache';
import type { ChatTranscriptScrollSnapshot } from '@/components/chat/ChatTranscriptBridge';
import type { ChatAgentMeta } from '@/services/chat-agent-meta';
import type {
  AgentStreamMetricsSnapshot,
  StreamMetricsAccRef,
} from '@/hooks/useAgentStreamMetrics';
import { useToast } from '@/components/chrome/ToastHost';
import { useRuntime } from '@/hooks/useRuntime';
import { useMobileScope } from '@/hooks/useMobileScope';
import { useAgentRunLifecycle } from '@/hooks/useAgentRunLifecycle';
import { useDismissOverlaysOnBlur } from '@/hooks/useDismissOverlaysOnBlur';
import { useNovelMaster } from '@/runtime/novel-master-context';
import {
  isMobileAgentActive,
  subscribeMobileAgentActivity,
} from '@/runtime/agent-activity';
import type { RootStackParamList } from '@/navigation/types';
import {
  defaultChatTranscriptEngine,
  readChatTranscriptEngine,
  type ChatTranscriptEngine,
} from '@/storage/chat-transcript-engine';
import { readChatRichTextEnabled } from '@/storage/chat-rich-text-pref';
import { readChatStreamBatchEnabled } from '@/storage/chat-stream-batch-pref';
import { useChatTabMessages } from './useChatTabMessages';
import {
  useChatTabScope,
  type ChatSubview,
  type ConversationPanel,
} from './useChatTabScope';
import { useChatTabScrollCache } from './useChatTabStream';
import { useSessionAbort } from './useSessionAbort';
import { useSessionBatch } from './useSessionBatch';
import { useSessionStream } from './useSessionStream';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export type ChatTabContextValue = {
  readonly tokens?: never;
  readonly projectId: string | undefined;
  readonly sessionId: string | undefined;
  readonly conversationPanel: ConversationPanel;
  readonly setConversationPanel: (panel: ConversationPanel) => void;
  readonly chatSubview: ChatSubview;
  readonly setChatSubview: (subview: ChatSubview) => void;
  readonly agentMeta: ChatAgentMeta;
  readonly uiRunning: boolean;
  readonly agentActive: boolean;
  readonly activeRunId: string | null;
  readonly streamTailGenerating: boolean;
  readonly streamingText: string;
  readonly streamingThinking: string;
  readonly streamMetricsLastRun: AgentStreamMetricsSnapshot | null;
  readonly streamMetricsAccRef: StreamMetricsAccRef;
  readonly onStreamReset: () => void;
  readonly chatMessages: ChatMessage[];
  readonly hasMoreMessages: boolean;
  readonly loadingMoreMessages: boolean;
  readonly onMessagesChanged: () => void;
  readonly canResumeWithoutInput: boolean;
  readonly lastMessageHasToolResult: boolean;
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
    | { messageId: string; initialText: string }
    | undefined;
  readonly setMessageEditPrompt: (
    prompt: { messageId: string; initialText: string } | undefined,
  ) => void;
  readonly useWebviewTranscript: boolean;
  readonly chatRichTextEnabled: boolean;
  /**
   * pending task 工具的子会话映射（title → childSessionId）。
   * 由 EVENT_SUBAGENT_CHILD_SESSION_CREATED 维护，让执行中的 task 卡片可点击进入子会话。
   */
  readonly pendingSubagentSessions: ReadonlyMap<string, string>;
  readonly richRenderEpoch: number;
  readonly webMenuCloseSignal: number;
  readonly webMenuOpen: boolean;
  readonly setWebMenuOpen: (open: boolean) => void;
  readonly beginUiRun: () => void;
  /** UI run 异常收尾（composer catch 路径用）。 */
  readonly endUiRunOnError: () => void;
  readonly abortUiRun: () => void;
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
  readonly resetStreamingDisplay: () => void;
  readonly navigation: Nav;
  readonly showToast: (message: string) => void;
  readonly runtime: ReturnType<typeof useRuntime>;
  readonly setCurrentSession: (sessionId: string) => Promise<void>;
  readonly closeMessageMenu: () => void;
};

const ChatTabCtx = createContext<ChatTabContextValue | null>(null);

export function useChatTabContext(): ChatTabContextValue {
  const ctx = useContext(ChatTabCtx);
  if (ctx == null) {
    throw new Error('useChatTabContext 须在 ChatTabProvider 内使用');
  }
  return ctx;
}

export function ChatTabProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const runtime = useRuntime();
  const {
    projectId,
    sessionId,
    setCurrentProject,
    setCurrentSession,
    refreshScope,
  } = useMobileScope();
  const navigation = useNavigation<Nav>();
  const { appUi, richRenderEpoch } = useNovelMaster();

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
    runtime,
    projectId,
    sessionId,
    chatSubview: scope.chatSubview,
    onAfterExternalReload: scope.refreshChatTokenLabel,
  });

  const { refreshChatMeta } = scope;
  useEffect(() => {
    if (scope.chatSubview === 'conversation' && sessionId != null) {
      refreshChatMeta().catch(() => undefined);
    }
  }, [scope.chatSubview, sessionId, projectId, refreshChatMeta]);

  // 订阅子会话创建事件：task 工具执行中（createChildSession）即发出，
  // 用 title → childSessionId 维护映射，让 pending 卡片也能点击进入子会话浏览。
  // 切换会话时清空，避免上一个会话的映射串到新会话。
  useEffect(() => {
    if (sessionId == null) {
      setPendingSubagentSessions(new Map());
      return undefined;
    }
    const sid = sessionId;
    setPendingSubagentSessions(new Map());
    const sub = runtime.eventBus.subscribe(
      EVENT_SUBAGENT_CHILD_SESSION_CREATED,
      (payload: SubagentChildSessionCreatedPayload) => {
        if (payload.parentSessionId !== sid) {
          return;
        }
        setPendingSubagentSessions(prev => {
          const next = new Map(prev);
          next.set(payload.title, payload.childSessionId);
          return next;
        });
      },
    );
    return () => sub.unsubscribe();
  }, [runtime.eventBus, sessionId]);

  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const transcriptWebRef = useRef<ChatTranscriptWebViewHandle>(null);
  const workspaceVfsRef = useRef<VfsFileManagerHandle>(null);
  const [chatRichTextEnabled, setChatRichTextEnabled] = useState(false);
  const [pendingSubagentSessions, setPendingSubagentSessions] = useState<
    Map<string, string>
  >(() => new Map());
  const [chatStreamBatchEnabled, setChatStreamBatchEnabled] = useState(true);
  const [messageMenuTarget, setMessageMenuTarget] = useState<
    ChatMessage | undefined
  >();
  const [messageMenuAnchor, setMessageMenuAnchor] = useState<
    MessageMenuAnchor | undefined
  >();
  const [webMenuOpen, setWebMenuOpen] = useState(false);
  const [webMenuCloseSignal, setWebMenuCloseSignal] = useState(0);
  const [messageEditPrompt, setMessageEditPrompt] = useState<
    { messageId: string; initialText: string } | undefined
  >();
  const [chatTranscriptEngine, setChatTranscriptEngine] =
    useState<ChatTranscriptEngine>(defaultChatTranscriptEngine);

  const useWebviewTranscript = chatTranscriptEngine === 'webview';

  const scroll = useChatTabScrollCache({
    projectId,
    sessionId,
    useWebviewTranscript,
  });

  const onStreamResetRef = useRef<() => void>(() => undefined);
  const applySegmentsRef = useRef<(segments: readonly StreamWireChunk[]) => void>(
    () => undefined,
  );
  const agentRunningRef = useRef(false);
  const chatMessageCountRef = useRef(0);

  useEffect(() => {
    chatMessageCountRef.current = messages.chatMessages.length;
  }, [messages.chatMessages.length]);

  // 装配顺序（P1-2）：先实例化 abort 单元（传 onStreamResetRef 占位 no-op），
  // 再实例化 batch / lifecycle / stream，最后把 stream 输出的 handleStreamReset
  // 写入同一个 ref——这样 abort 状态机调 onStreamResetRef.current() 即可，
  // abort 与 stream 两个单元不直接 import。apply 叶子同理：batch 接收一个
  // ref 包装，stream mount 后把自己的 applySegments 写进去。
  const abort = useSessionAbort({
    sessionId,
    abortRegistry: runtime.abortRegistry,
    onStreamResetRef,
  });

  const [agentActive, setAgentActive] = useState(() => isMobileAgentActive());
  useEffect(() => subscribeMobileAgentActivity(setAgentActive), []);

  const lifecycle = useAgentRunLifecycle({
    onRunUiActivate: abort.markRunStarted,
    onRunUiDeactivate: abort.markRunEnded,
    getUiRunning: abort.getUiRunning,
  });

  useEffect(() => {
    abort.resetForSessionChange();
    lifecycle.resetUiForSessionChange();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 session 切换时重置 UI
  }, [sessionId]);

  const handleMessagesChanged = useCallback(
    (options?: { immediate?: boolean }) =>
      messages
        .handleMessagesChanged(scope.refreshChatTokenLabel, {
          agentRunning: agentRunningRef.current,
          immediate: options?.immediate,
        })
        .then(list => {
          chatMessageCountRef.current = list.length;
          return list;
        }),
    [messages, scope.refreshChatTokenLabel],
  );

  const batch = useSessionBatch({
    applySegments: segments => applySegmentsRef.current(segments),
  });

  const stream = useSessionStream({
    sessionId,
    useWebviewTranscript,
    batchEnabled: chatStreamBatchEnabled,
    transcriptWebRef,
    uiRunning: abort.uiRunning,
    acceptRunEvent: lifecycle.acceptRunEvent,
    onRunStarted: lifecycle.onRunStarted,
    onRunFinished: lifecycle.onRunFinished,
    onRunFailed: lifecycle.onRunFailed,
    getUiRunning: abort.getUiRunning,
    getTranscriptFreezeCount: abort.getTranscriptFreezeCount,
    getAbortRetainPending: abort.getAbortRetainPending,
    clearAbortRetainPending: abort.clearAbortRetainPending,
    batchIngest: batch.ingestWireChunk,
    batchClear: batch.clearBuffers,
    batchFlush: batch.flushBuffers,
    onMessagesChanged: handleMessagesChanged,
    getMessageCount: () => chatMessageCountRef.current,
  });
  // 拆环：stream mount 后把 apply 叶子 / stream reset 写入两个占位 ref。
  applySegmentsRef.current = stream.applySegments;
  onStreamResetRef.current = stream.handleStreamReset;

  const abortUiRunWithFreeze = useCallback(() => {
    abort.abortUiRun(chatMessageCountRef.current);
  }, [abort]);

  agentRunningRef.current = agentActive;

  const closeMessageMenu = useCallback(() => {
    setMessageMenuTarget(undefined);
    setMessageMenuAnchor(undefined);
    setWebMenuOpen(false);
    setWebMenuCloseSignal(signal => signal + 1);
  }, []);

  const {
    setProjectDrawerOpen,
    setSessionDrawerOpen,
    setSessionRenamePrompt,
    setMenuSessionId,
  } = scope;

  const dismissAllOverlays = useCallback(() => {
    setProjectDrawerOpen(false);
    setSessionDrawerOpen(false);
    setModelPickerOpen(false);
    setAgentPickerOpen(false);
    closeMessageMenu();
    setMessageEditPrompt(undefined);
    setSessionRenamePrompt(undefined);
    setMenuSessionId(undefined);
  }, [
    closeMessageMenu,
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

  const refreshChatStreamBatchPref = useCallback(async () => {
    setChatStreamBatchEnabled(await readChatStreamBatchEnabled(appUi));
  }, [appUi]);

  useFocusEffect(
    useCallback(() => {
      refreshChatRichTextPref().catch(() => undefined);
      refreshChatTranscriptEngine().catch(() => undefined);
      refreshChatStreamBatchPref().catch(() => undefined);
      refreshChatMeta().catch(() => undefined);
    }, [
      refreshChatRichTextPref,
      refreshChatTranscriptEngine,
      refreshChatStreamBatchPref,
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
      uiRunning: abort.uiRunning,
      agentActive,
      activeRunId: lifecycle.activeRunId,
      streamTailGenerating: abort.uiRunning,
      streamingText: stream.streamingText,
      streamingThinking: stream.streamingThinking,
      streamMetricsLastRun: stream.streamMetricsLastRun,
      streamMetricsAccRef: stream.streamMetricsAccRef,
      onStreamReset: stream.handleStreamReset,
      chatMessages: messages.chatMessages,
      hasMoreMessages: messages.hasMoreMessages,
      loadingMoreMessages: messages.loadingMoreMessages,
      onMessagesChanged: () =>
        handleMessagesChanged().catch(() => undefined),
      canResumeWithoutInput: messages.canResumeWithoutInput,
      lastMessageHasToolResult: messages.lastMessageHasToolResult,
      lastMessageIsPlainUserText: messages.lastMessageIsPlainUserText,
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
      pendingSubagentSessions,
      richRenderEpoch,
      webMenuCloseSignal,
      webMenuOpen,
      setWebMenuOpen,
      beginUiRun: lifecycle.beginUiRun,
      endUiRunOnError: lifecycle.endUiRunOnError,
      abortUiRun: abortUiRunWithFreeze,
      onLoadOlderMessages: () =>
        messages.loadOlderMessages().catch(() => undefined),
      onOpenFileEditor: scope.openFileEditor,
      onNeedModel: () => setModelPickerOpen(true),
      onRefreshChatMeta: () => scope.refreshChatMeta().catch(() => undefined),
      transcriptWebRef,
      workspaceVfsRef,
      scope,
      messages,
      resetStreamingDisplay: stream.resetStreamingDisplay,
      navigation,
      showToast,
      runtime,
      setCurrentSession,
      closeMessageMenu,
    }),
    [
      projectId,
      sessionId,
      scope,
      lifecycle,
      abort,
      agentActive,
      stream,
      messages,
      handleMessagesChanged,
      scroll,
      modelPickerOpen,
      agentPickerOpen,
      messageMenuTarget,
      messageMenuAnchor,
      messageEditPrompt,
      useWebviewTranscript,
      chatRichTextEnabled,
      pendingSubagentSessions,
      richRenderEpoch,
      webMenuCloseSignal,
      webMenuOpen,
      navigation,
      showToast,
      runtime,
      setCurrentSession,
      closeMessageMenu,
      abortUiRunWithFreeze,
    ],
  );

  return <ChatTabCtx.Provider value={value}>{children}</ChatTabCtx.Provider>;
}
