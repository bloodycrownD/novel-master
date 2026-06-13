/**
 * Chat tab: session list / template sub-tabs, conversation workspace (M1 skeleton).
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Alert, StyleSheet, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ChatMessage} from '@novel-master/core';
import type {
  AgentRunFinishedPayload,
  AgentStepCommittedPayload,
} from '@novel-master/core';
import {AppHeader} from '../../components/chrome/AppHeader';
import {useToast} from '../../components/chrome/ToastHost';
import {
  buildMessageActionItems,
} from '../../components/chat/message-edit';
import type {MessageMenuAnchor} from '../../components/chat/MessageActionMenu';
import type {ChatTranscriptWebViewHandle} from '../../components/chat/ChatTranscriptWebView';
import {ProjectDrawer} from '../../components/chrome/ProjectDrawer';
import {useHeaderContext} from '../../navigation/HeaderContext';
import type {RootStackParamList} from '../../navigation/types';
import {useAndroidChatBackHandler} from '../../hooks/useAndroidChatBackHandler';
import type {VfsFileManagerHandle} from '../../components/vfs/VfsFileManager';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {TextPromptModal} from '../../components/ui/TextPromptModal';
import {useRuntime} from '../../hooks/useRuntime';
import {useMobileScope} from '../../hooks/useMobileScope';
import {readChatRichTextEnabled} from '../../storage/chat-rich-text-pref';
import {
  defaultChatTranscriptEngine,
  readChatTranscriptEngine,
  type ChatTranscriptEngine,
} from '../../storage/chat-transcript-engine';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {useTheme} from '../../theme/ThemeProvider';
import {ChatConversationPanel} from './chat-tab/ChatConversationPanel';
import {ChatSessionListPanel} from './chat-tab/ChatSessionListPanel';
import {
  useChatTabMessageActions,
  useChatTabMessages,
} from './chat-tab/useChatTabMessages';
import {useChatTabScope} from './chat-tab/useChatTabScope';
import {
  useChatTabScrollCache,
  useChatTabStream,
} from './chat-tab/useChatTabStream';
type Nav = NativeStackNavigationProp<RootStackParamList>;

export function ChatTabScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const {projectId, sessionId, setCurrentProject, setCurrentSession, refreshScope} =
    useMobileScope();
  const {setChat} = useHeaderContext();
  const navigation = useNavigation<Nav>();

  const sessionBatch = useBatchSelection();
  const messageBatch = useBatchSelection();
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
    runtime,
    projectId,
    sessionId,
    chatSubview: scope.chatSubview,
  });

  const {refreshChatMeta} = scope;
  useEffect(() => {
    if (scope.chatSubview === 'conversation' && sessionId != null) {
      refreshChatMeta().catch(() => undefined);
    }
  }, [scope.chatSubview, sessionId, refreshChatMeta]);

  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const transcriptWebRef = useRef<ChatTranscriptWebViewHandle>(null);
  const workspaceVfsRef = useRef<VfsFileManagerHandle>(null);
  const [workspaceBackState, setWorkspaceBackState] = useState<{
    canGoUp: boolean;
    goUp: () => void;
  } | null>(null);
  const [chatRichTextEnabled, setChatRichTextEnabled] = useState(false);
  const [chatTranscriptEngine, setChatTranscriptEngine] =
    useState<ChatTranscriptEngine>(defaultChatTranscriptEngine);
  const [messageMenuTarget, setMessageMenuTarget] = useState<
    ChatMessage | undefined
  >();
  const [messageMenuAnchor, setMessageMenuAnchor] = useState<
    MessageMenuAnchor | undefined
  >();
  const [webMenuOpen, setWebMenuOpen] = useState(false);
  const [webMenuCloseSignal, setWebMenuCloseSignal] = useState(0);
  const [messageEditPrompt, setMessageEditPrompt] = useState<
    {messageId: string; initialText: string} | undefined
  >();

  const useWebviewTranscript = chatTranscriptEngine === 'webview';
  const stream = useChatTabStream({
    useWebviewTranscript,
    transcriptWebRef,
  });
  const scroll = useChatTabScrollCache({
    projectId,
    sessionId,
    useWebviewTranscript,
  });

  const messageActions = useChatTabMessageActions({
    runtime,
    projectId,
    sessionId,
    messages,
    messageBatch,
    agentRunning: stream.agentRunning,
    resetStreamingDisplay: stream.resetStreamingDisplay,
    showToast,
    refreshChatTokenLabel: scope.refreshChatTokenLabel,
    bumpVfsRefresh: scope.bumpVfsRefresh,
    reloadLists: scope.reloadLists,
    setCurrentSession,
    setChatSubview: scope.setChatSubview,
    setConversationPanel: scope.setConversationPanel,
    setMessageEditPrompt,
  });

  const transcriptFlags = useMemo(
    () => ({
      richText: chatRichTextEnabled,
      batchMode: messageBatch.active,
    }),
    [chatRichTextEnabled, messageBatch.active],
  );

  const closeMessageMenu = useCallback(() => {
    setMessageMenuTarget(undefined);
    setMessageMenuAnchor(undefined);
    setWebMenuOpen(false);
    setWebMenuCloseSignal(signal => signal + 1);
  }, []);

  const handleStepCommitted = useCallback(
    (payload: AgentStepCommittedPayload) => {
      if (payload.phase === 'tool_results' && payload.vfsMutated === true) {
        scope.bumpVfsRefresh();
      }
    },
    [scope.bumpVfsRefresh],
  );

  const handleRunFinished = useCallback(
    (payload: AgentRunFinishedPayload) => {
      if (payload.vfsMutated === true) {
        scope.bumpVfsRefresh();
      }
    },
    [scope.bumpVfsRefresh],
  );

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

  useAndroidChatBackHandler(
    {
      chatSubview: scope.chatSubview,
      conversationPanel: scope.conversationPanel,
      sessionListPanel: scope.sessionListPanel,
      sessionDrawerOpen: scope.sessionDrawerOpen,
      messageMenuOpen: messageMenuTarget != null || webMenuOpen,
      messageBatchActive: messageBatch.active,
      messageEditOpen: messageEditPrompt != null,
      modelPickerOpen,
      agentPickerOpen,
      sessionRenameOpen: scope.sessionRenamePrompt != null,
      projectDrawerOpen: scope.projectDrawerOpen,
      sessionBatchActive: sessionBatch.active,
      workspaceCanGoUp: workspaceBackState?.canGoUp ?? false,
      workspaceGoUp: workspaceBackState?.goUp,
    },
    {
      backFromConversation: scope.backFromConversation,
      showChatPanel: () => scope.setConversationPanel('chat'),
      closeSessionDrawer: () => scope.setSessionDrawerOpen(false),
      closeMessageMenu,
      exitMessageBatch: messageActions.exitMessageBatch,
      closeMessageEdit: () => setMessageEditPrompt(undefined),
      closeModelPicker: () => setModelPickerOpen(false),
      closeAgentPicker: () => setAgentPickerOpen(false),
      closeSessionRename: () => scope.setSessionRenamePrompt(undefined),
      closeProjectDrawer: () => scope.setProjectDrawerOpen(false),
      exitSessionBatch: sessionBatch.exit,
      showSessionsPanel: () => scope.setSessionListPanel('sessions'),
    },
  );

  useEffect(() => {
    setChat({
      chatSubview: scope.chatSubview,
      sessionListPanel: scope.sessionListPanel,
      sessionTitle: scope.currentSession?.title ?? scope.currentSession?.id,
      agentName:
        scope.chatSubview === 'conversation' ? scope.agentMeta.agentName : undefined,
      modelLabel:
        scope.chatSubview === 'conversation' ? scope.agentMeta.modelLabel : undefined,
      onBackFromConversation: scope.backFromConversation,
      onOpenDrawer: () => {
        if (scope.chatSubview === 'conversation') {
          scope.setSessionDrawerOpen(true);
        } else {
          scope.setProjectDrawerOpen(true);
        }
      },
    });
  }, [
    scope.chatSubview,
    scope.sessionListPanel,
    scope.currentSession,
    scope.agentMeta,
    setChat,
    scope.backFromConversation,
    scope.setSessionDrawerOpen,
    scope.setProjectDrawerOpen,
  ]);

  const openConversation = useCallback(
    async (sid: string) => {
      if (projectId == null) {
        return;
      }
      await setCurrentSession(sid);
      messages.hydrateFromSessionCache(projectId, sid);
      scope.setChatSubview('conversation');
      scope.setConversationPanel('chat');
    },
    [projectId, setCurrentSession, messages, scope],
  );

  const confirmBatchDelete = useCallback(() => {
    const count = sessionBatch.selectedCount;
    if (count === 0) {
      return;
    }
    Alert.alert(
      '确认删除',
      `确定删除选中的 ${count} 个会话？`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () =>
            scope
              .deleteSelectedSessions(sessionBatch.selectedIds, sessionBatch.exit)
              .catch(() => undefined),
        },
      ],
    );
  }, [sessionBatch, scope]);

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
      // Re-read KKV currentModelId when returning from Profile tab.
      refreshChatMeta().catch(() => undefined);
    }, [refreshChatRichTextPref, refreshChatTranscriptEngine, refreshChatMeta]),
  );

  const sessionRenameModal = (
    <TextPromptModal
      visible={scope.sessionRenamePrompt != null}
      title="重命名会话"
      label="会话名称"
      placeholder="输入会话名称"
      initialValue={scope.sessionRenamePrompt?.initialTitle ?? ''}
      confirmLabel="保存"
      onClose={() => scope.setSessionRenamePrompt(undefined)}
      onConfirm={async value => {
        const prompt = scope.sessionRenamePrompt;
        scope.setSessionRenamePrompt(undefined);
        if (prompt) {
          await scope.handleRenameSession(prompt.sessionId, value);
        }
      }}
    />
  );

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <AppHeader pageKey="chat" />
      {scope.chatSubview === 'conversation' ? (
      <ChatConversationPanel
        tokens={tokens}
        visible
        conversationPanel={scope.conversationPanel}
        onConversationPanelChange={scope.setConversationPanel}
        projectId={projectId}
        sessionId={sessionId}
        agentMeta={scope.agentMeta}
        streamMetrics={stream.streamMetrics}
        messageBatchActive={messageBatch.active}
        messageBatchSelectedCount={messageBatch.selectedCount}
        messageBatchSelectedIds={messageBatch.selectedIds}
        onExitMessageBatch={messageActions.exitMessageBatch}
        onConfirmMessageBatchDelete={messageActions.confirmMessageBatchDelete}
        onConfirmBatchHideMessages={messageActions.confirmBatchHideMessages}
        onConfirmBatchUnhideMessages={messageActions.confirmBatchUnhideMessages}
        useWebviewTranscript={useWebviewTranscript}
        transcriptWebRef={transcriptWebRef}
        chatScrollKey={scroll.chatScrollKey}
        chatMessages={messages.chatMessages}
        hasMoreMessages={messages.hasMoreMessages}
        agentRunning={stream.agentRunning}
        transcriptFlags={transcriptFlags}
        webMenuCloseSignal={webMenuCloseSignal}
        restoredTranscriptScroll={scroll.restoredTranscriptScroll}
        defaultChatScrollToBottom={scroll.defaultChatScrollToBottom}
        cachedChatScroll={scroll.cachedChatScroll}
        streamingText={stream.streamingText}
        streamingThinking={stream.streamingThinking}
        chatRichTextEnabled={chatRichTextEnabled}
        richRenderEpoch={richRenderEpoch}
        loadingMoreMessages={messages.loadingMoreMessages}
        hasWorkspaceModel={scope.hasWorkspaceModel}
        canResumeWithoutInput={messages.canResumeWithoutInput}
        vfsRefreshKey={scope.vfsRefreshKey}
        sessionVfs={scope.sessionVfs}
        sessionWorktree={scope.sessionWorktree}
        sessionDrawerOpen={scope.sessionDrawerOpen}
        onCloseSessionDrawer={() => scope.setSessionDrawerOpen(false)}
        onOpenSessionRename={() => {
          if (sessionId != null) {
            scope.setSessionDrawerOpen(false);
            scope.openSessionRenamePrompt(sessionId);
          }
        }}
        onCompactSession={() => {
          scope.setSessionDrawerOpen(false);
          messageActions.handleCompactSession();
        }}
        onNavigateRealPrompt={() => navigation.navigate('RealPrompt')}
        onEnterMessageBatch={() => {
          scope.setSessionDrawerOpen(false);
          messageActions.enterMessageBatch();
        }}
        modelPickerOpen={modelPickerOpen}
        agentPickerOpen={agentPickerOpen}
        onCloseModelPicker={() => setModelPickerOpen(false)}
        onCloseAgentPicker={() => setAgentPickerOpen(false)}
        onRefreshChatMeta={() => scope.refreshChatMeta().catch(() => undefined)}
        messageMenuTarget={messageMenuTarget}
        messageMenuAnchor={messageMenuAnchor}
        messageMenuItems={
          messageMenuTarget != null
            ? buildMessageActionItems(messageMenuTarget)
            : []
        }
        useWebviewMessageMenu={!useWebviewTranscript}
        onCloseMessageMenu={closeMessageMenu}
        onMessageMenuSelect={action => {
          const target = messageMenuTarget;
          closeMessageMenu();
          if (target == null) {
            return;
          }
          messageActions.handleMessageMenuAction(target, action);
        }}
        messageEditPrompt={messageEditPrompt}
        onCloseMessageEdit={() => setMessageEditPrompt(undefined)}
        onSaveMessageEdit={messageActions.handleSaveMessageEdit}
        onChatScrollSnapshot={scroll.handleChatScrollSnapshot}
        onLoadOlderMessages={() => messages.loadOlderMessages().catch(() => undefined)}
        onOpenSessionFilePreview={scope.openSessionFilePreview}
        onWebMenuOpenChange={open => {
          setWebMenuOpen(open);
          if (!open) {
            setMessageMenuTarget(undefined);
            setMessageMenuAnchor(undefined);
          }
        }}
        onWebMessageMenuAction={(messageId, action) => {
          const target = messages.chatMessages.find(m => m.id === messageId);
          if (target == null) {
            return;
          }
          messageActions.handleMessageMenuAction(target, action);
        }}
        onToggleMessageSelect={messageBatch.toggle}
        onMessageLongPress={(msg, anchor) => {
          if (stream.agentRunning) {
            return;
          }
          setMessageMenuTarget(msg);
          setMessageMenuAnchor(anchor);
        }}
        onAgentRunningChange={stream.setAgentRunning}
        onStreamText={stream.handleStreamText}
        onStreamThinking={stream.handleStreamThinking}
        onStreamToolUseDelta={stream.handleStreamToolUseDelta}
        onStreamReset={stream.handleStreamReset}
        onMessagesChanged={() =>
          messages.handleMessagesChanged(scope.refreshChatTokenLabel).catch(() => undefined)
        }
        onStepCommitted={handleStepCommitted}
        onRunFinished={handleRunFinished}
        onNeedModel={() => setModelPickerOpen(true)}
        bumpVfsRefresh={scope.bumpVfsRefresh}
        onOpenFileEditor={scope.openFileEditor}
        workspaceVfsRef={workspaceVfsRef}
        onWorkspaceBackStateChange={setWorkspaceBackState}
      />
      ) : null}
      <ChatSessionListPanel
        tokens={tokens}
        visible={scope.chatSubview === 'sessions'}
        currentProject={scope.currentProject}
        sessionListPanel={scope.sessionListPanel}
        onSessionListPanelChange={scope.setSessionListPanel}
        onOpenProjectDrawer={() => scope.setProjectDrawerOpen(true)}
        projectId={projectId}
        sessionId={sessionId}
        sessions={scope.sessions}
        vfsRefreshKey={scope.vfsRefreshKey}
        projectVfs={scope.projectVfs}
        projectWorktree={scope.projectWorktree}
        sessionBatchActive={sessionBatch.active}
        sessionBatchSelectedCount={sessionBatch.selectedCount}
        onEnterSessionBatch={sessionBatch.enter}
        onExitSessionBatch={sessionBatch.exit}
        onConfirmBatchDelete={confirmBatchDelete}
        onCreateSession={() => scope.handleCreateSession().catch(() => undefined)}
        onOpenConversation={sid => openConversation(sid).catch(() => undefined)}
        onToggleSessionSelect={sessionBatch.toggle}
        isSessionSelected={sessionBatch.isSelected}
        menuSessionId={scope.menuSessionId}
        onMenuSessionIdChange={scope.setMenuSessionId}
        onOpenSessionRename={scope.openSessionRenamePrompt}
        onCopySession={sid => scope.handleCopySession(sid).catch(() => undefined)}
        onConfirmDeleteSession={scope.confirmDeleteSession}
        bumpVfsRefresh={scope.bumpVfsRefresh}
        onOpenFileEditor={scope.openFileEditor}
      />
      {sessionRenameModal}
      <ProjectDrawer
        visible={scope.projectDrawerOpen}
        projects={scope.projects}
        currentProjectId={projectId}
        onClose={() => scope.setProjectDrawerOpen(false)}
        onSelect={async id => {
          await setCurrentProject(id);
          await scope.reloadLists();
        }}
        onCreateProject={scope.handleCreateProject}
        onRenameProject={scope.handleRenameProject}
        onDeleteSelected={scope.handleDeleteProjects}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
