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
import type { WorktreeService } from '@novel-master/core/worktree';
import type { ChatTranscriptWebViewHandle } from '@/components/chat/ChatTranscriptWebView';
import type { MessageMenuAnchor } from '@/components/chat/MessageActionMenu';
import type { VfsFileManagerHandle } from '@/components/vfs/VfsFileManager';
import type { ChatListScrollSnapshot } from '@/services/chat-list-scroll-cache';
import type { ChatTranscriptScrollSnapshot } from '@/components/chat/ChatTranscriptBridge';
import type { ChatAgentMeta } from '@/services/chat-agent-meta';
import type {
  AgentStreamMetricsSnapshot,
  StreamMetricsAccRef,
} from '@/hooks/useAgentStreamMetrics';
import type { MessageBatchMode } from '@/components/chat/transcript-selectable-role';
import { useToast } from '@/components/chrome/ToastHost';
import { useRuntime } from '@/hooks/useRuntime';
import { useMobileScope } from '@/hooks/useMobileScope';
import { useAgentRunLifecycle } from '@/hooks/useAgentRunLifecycle';
import { useBatchSelection } from '@/hooks/useBatchSelection';
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
import {
  useChatTabMessages,
} from './useChatTabMessages';
import {
  useChatTabScope,
  type ChatSubview,
  type ConversationPanel,
} from './useChatTabScope';
import { useChatTabScrollCache } from './useChatTabStream';
import { useChatStreamRuntime } from './useChatStreamRuntime';

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
  readonly messageBatchActive: boolean;
  readonly messageBatchMode: MessageBatchMode | null;
  readonly messageBatchSelectedIds: ReadonlySet<string>;
  readonly messageBatchSelectedCount: number;
  readonly onMessagesChanged: () => void;
  readonly canResumeWithoutInput: boolean;
  readonly lastMessageHasToolResult: boolean;
  readonly lastMessageIsPlainUserText: boolean;
  readonly sessionVfs: VfsService | null;
  readonly sessionWorktree: WorktreeService | null;
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
  readonly setMessageMenuAnchor: (anchor: MessageMenuAnchor | undefined) => void;
  readonly messageEditPrompt:
    | { messageId: string; initialText: string }
    | undefined;
  readonly setMessageEditPrompt: (
    prompt: { messageId: string; initialText: string } | undefined,
  ) => void;
  readonly useWebviewTranscript: boolean;
  readonly chatRichTextEnabled: boolean;
  readonly richRenderEpoch: number;
  readonly webMenuCloseSignal: number;
  readonly webMenuOpen: boolean;
  readonly setWebMenuOpen: (open: boolean) => void;
  readonly beginUiRun: () => void;
  readonly abortUiRun: () => void;
  readonly onLoadOlderMessages: () => void;
  readonly onOpenFileEditor: (
    path: string,
    scopeKind: 'project' | 'session',
  ) => void;
  readonly onNeedModel: () => void;
  readonly onRefreshChatMeta: () => void;
  readonly exitMessageBatch: () => void;
  readonly transcriptWebRef: React.RefObject<ChatTranscriptWebViewHandle | null>;
  readonly workspaceVfsRef: React.RefObject<VfsFileManagerHandle | null>;
  readonly scope: ReturnType<typeof useChatTabScope>;
  readonly messageBatch: ReturnType<typeof useBatchSelection>;
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
  const messageBatch = useBatchSelection();
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
  });

  const { refreshChatMeta } = scope;
  useEffect(() => {
    if (scope.chatSubview === 'conversation' && sessionId != null) {
      refreshChatMeta().catch(() => undefined);
    }
  }, [scope.chatSubview, sessionId, projectId, refreshChatMeta]);

  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const transcriptWebRef = useRef<ChatTranscriptWebViewHandle>(null);
  const workspaceVfsRef = useRef<VfsFileManagerHandle>(null);
  const [chatRichTextEnabled, setChatRichTextEnabled] = useState(false);
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

  const agentRunningRef = useRef(false);
  const streamResetRef = useRef<() => void>(() => undefined);
  const chatMessageCountRef = useRef(0);

  useEffect(() => {
    chatMessageCountRef.current = messages.chatMessages.length;
  }, [messages.chatMessages.length]);

  const lifecycle = useAgentRunLifecycle({
    onStreamReset: () => streamResetRef.current(),
  });

  const [agentActive, setAgentActive] = useState(() => isMobileAgentActive());
  useEffect(() => subscribeMobileAgentActivity(setAgentActive), []);

  useEffect(() => {
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

  const stream = useChatStreamRuntime({
    sessionId,
    uiRunning: lifecycle.uiRunning,
    useWebviewTranscript,
    chatStreamBatchEnabled,
    transcriptWebRef,
    onMessagesChanged: handleMessagesChanged,
    getMessageCount: () => chatMessageCountRef.current,
    acceptRunEvent: lifecycle.acceptRunEvent,
    onRunStarted: lifecycle.onRunStarted,
    onRunFinished: lifecycle.onRunFinished,
    onRunFailed: lifecycle.onRunFailed,
  });
  streamResetRef.current = stream.handleStreamReset;

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
      uiRunning: lifecycle.uiRunning,
      agentActive,
      activeRunId: lifecycle.activeRunId,
      streamTailGenerating: lifecycle.uiRunning,
      streamingText: stream.streamingText,
      streamingThinking: stream.streamingThinking,
      streamMetricsLastRun: stream.streamMetricsLastRun,
      streamMetricsAccRef: stream.streamMetricsAccRef,
      onStreamReset: stream.handleStreamReset,
      chatMessages: messages.chatMessages,
      hasMoreMessages: messages.hasMoreMessages,
      loadingMoreMessages: messages.loadingMoreMessages,
      messageBatchActive: messageBatch.active,
      messageBatchMode: messageBatch.mode,
      messageBatchSelectedIds: messageBatch.selectedIds,
      messageBatchSelectedCount: messageBatch.selectedCount,
      onMessagesChanged: () => handleMessagesChanged().catch(() => undefined),
      canResumeWithoutInput: messages.canResumeWithoutInput,
      lastMessageHasToolResult: messages.lastMessageHasToolResult,
      lastMessageIsPlainUserText: messages.lastMessageIsPlainUserText,
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
      richRenderEpoch,
      webMenuCloseSignal,
      webMenuOpen,
      setWebMenuOpen,
      beginUiRun: lifecycle.beginUiRun,
      abortUiRun: lifecycle.abortUiRun,
      onLoadOlderMessages: () =>
        messages.loadOlderMessages().catch(() => undefined),
      onOpenFileEditor: scope.openFileEditor,
      onNeedModel: () => setModelPickerOpen(true),
      onRefreshChatMeta: () => scope.refreshChatMeta().catch(() => undefined),
      exitMessageBatch: () => messageBatch.exit(),
      transcriptWebRef,
      workspaceVfsRef,
      scope,
      messageBatch,
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
      agentActive,
      stream,
      messages,
      messageBatch,
      handleMessagesChanged,
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
      navigation,
      messages,
      messageBatch,
      showToast,
      runtime,
      setCurrentSession,
      closeMessageMenu,
    ],
  );

  return <ChatTabCtx.Provider value={value}>{children}</ChatTabCtx.Provider>;
}
