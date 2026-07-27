/**
 * Chat tab conversation subview: transcript, composer, session workspace.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  KeyboardStickyView,
  useKeyboardState,
} from 'react-native-keyboard-controller';
import { type VfsScope } from '@novel-master/core/vfs';
import { AgentPickerModal } from '@/components/agent/AgentPickerModal';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { ChatMetaBar } from '@/components/chat/ChatMetaBar';
import { ChatStreamMetricsBarLive } from '@/components/chat/ChatStreamMetricsBarLive';
import { ChatTranscriptWebView } from '@/components/chat/ChatTranscriptWebView';
import { MessageActionMenu } from '@/components/chat/MessageActionMenu';
import { MessageEditModal } from '@/components/chat/MessageEditModal';
import { MessageList } from '@/components/chat/MessageList';
import { ModelPickerModal } from '@/components/provider/ModelPickerModal';
import { SessionActionsDrawer } from '@/components/chrome/SessionActionsDrawer';
import { VfsFileManager } from '@/components/vfs/VfsFileManager';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import type { ThemeTokens } from '@/theme/tokens';
import { useChatTabContext } from './ChatTabProvider';
import { useChatTabWorkspaceBackState } from './ChatTabNavigationProvider';
import { useChatTabController } from './useChatTabController';

export type ChatConversationPanelProps = {
  tokens: ThemeTokens;
  visible: boolean;
};

/**
 * Android：用 keyboard-controller 抬输入框（曾验证有效），
 * 消息区按键盘高度留出 margin，避免 StickyView 盖住最后几条。
 * 不手算 measure / RN Keyboard 脏高度。
 */
function AndroidKeyboardChatBody({
  style,
  pointerEvents,
  header,
  transcript,
  composer,
  onKeyboardLifted,
}: {
  style?: StyleProp<ViewStyle>;
  pointerEvents?: 'auto' | 'none';
  header: React.ReactNode;
  transcript: React.ReactNode;
  composer: React.ReactNode;
  onKeyboardLifted?: () => void;
}) {
  const keyboardHeight = useKeyboardState(state => state.height);
  const keyboardVisible = useKeyboardState(state => state.isVisible);
  const transcriptReserve = keyboardVisible
    ? Math.max(0, Math.round(keyboardHeight))
    : 0;

  useEffect(() => {
    if (!keyboardVisible || transcriptReserve <= 0 || onKeyboardLifted == null) {
      return;
    }
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        onKeyboardLifted();
      });
    });
    return () => cancelAnimationFrame(outer);
  }, [keyboardVisible, transcriptReserve, onKeyboardLifted]);

  return (
    <View style={style} pointerEvents={pointerEvents}>
      {header}
      <View
        style={[
          styles.transcriptHost,
          transcriptReserve > 0 ? { marginBottom: transcriptReserve } : null,
        ]}
      >
        {transcript}
      </View>
      <KeyboardStickyView>{composer}</KeyboardStickyView>
    </View>
  );
}

export function ChatConversationPanel({
  tokens,
  visible,
}: ChatConversationPanelProps) {
  const ctx = useChatTabContext();
  const controller = useChatTabController();
  const setWorkspaceBackState = useChatTabWorkspaceBackState();
  const {
    conversationPanel,
    setConversationPanel,
    projectId,
    sessionId,
    agentMeta,
    streamMetricsAccRef,
    streamMetricsLastRun,
    uiRunning,
    agentActive,
    useWebviewTranscript,
    transcriptWebRef,
    chatScrollKey,
    chatMessages,
    hasMoreMessages,
    chatRichTextEnabled,
    richRenderEpoch,
    webMenuCloseSignal,
    restoredTranscriptScroll,
    defaultChatScrollToBottom,
    cachedChatScroll,
    streamingText,
    streamingThinking,
    loadingMoreMessages,
    hasWorkspaceModel,
    canResumeWithoutInput,
    lastMessageHasToolResult,
    lastMessageIsPlainUserText,
    draftRestoreToken,
    vfsRefreshKey,
    sessionVfs,
    sessionWorktree,
    sessionDrawerOpen,
    setSessionDrawerOpen,
    modelPickerOpen,
    setModelPickerOpen,
    agentPickerOpen,
    setAgentPickerOpen,
    messageMenuTarget,
    messageMenuAnchor,
    messageEditPrompt,
    setMessageEditPrompt,
    beginUiRun,
    abortUiRun,
    onStreamReset,
    onMessagesChanged,
    onNeedModel,
    bumpWorktreeUiToken,
    onOpenFileEditor,
    onChatScrollSnapshot,
    onLoadOlderMessages,
    onRefreshChatMeta,
    workspaceVfsRef,
    scope,
  } = ctx;

  const transcriptFlags = useMemo(
    () => ({
      richText: chatRichTextEnabled,
    }),
    [chatRichTextEnabled],
  );

  const sessionVfsScope = useMemo((): VfsScope | null => {
    if (projectId == null || sessionId == null) {
      return null;
    }
    return { kind: 'session', projectId, sessionId };
  }, [projectId, sessionId]);

  const emitWorkspaceBackState = useCallback(() => {
    if (setWorkspaceBackState == null) {
      return;
    }
    if (conversationPanel !== 'workspace') {
      setWorkspaceBackState(null);
      return;
    }
    const handle = workspaceVfsRef?.current;
    if (!handle) {
      setWorkspaceBackState(null);
      return;
    }
    setWorkspaceBackState({
      canGoUp: handle.canGoUp(),
      goUp: () => handle.goUp(),
    });
  }, [conversationPanel, setWorkspaceBackState, workspaceVfsRef]);

  useEffect(() => {
    emitWorkspaceBackState();
  }, [emitWorkspaceBackState, vfsRefreshKey]);

  useEffect(() => {
    if (conversationPanel === 'workspace') {
      void workspaceVfsRef?.current?.reload();
    }
  }, [conversationPanel, workspaceVfsRef]);

  const [keyboardLiftNonce, setKeyboardLiftNonce] = useState(0);
  const onKeyboardLifted = useCallback(() => {
    setKeyboardLiftNonce(n => n + 1);
  }, []);

  const chatPanelStyle = [
    styles.chatPanel,
    conversationPanel !== 'chat' && styles.panelHidden,
  ];
  const chatPointerEvents =
    conversationPanel === 'chat' ? ('auto' as const) : ('none' as const);
  const chatHeader =
    projectId != null && sessionId != null ? (
      <>
        <ChatMetaBar meta={agentMeta} />
        <ChatStreamMetricsBarLive
          agentRunning={uiRunning}
          accRef={streamMetricsAccRef}
          lastRun={streamMetricsLastRun}
        />
      </>
    ) : null;
  const chatTranscript =
    projectId != null && sessionId != null ? (
      useWebviewTranscript ? (
        <ChatTranscriptWebView
          ref={transcriptWebRef}
          key={chatScrollKey ?? 'no-session-scroll'}
          sessionKey={chatScrollKey ?? 'no-session'}
          messages={chatMessages}
          hasMore={hasMoreMessages}
          agentRunning={agentActive}
          uiRunning={uiRunning}
          toolInvoking={uiRunning}
          flags={transcriptFlags}
          menuCloseSignal={webMenuCloseSignal}
          initialScroll={restoredTranscriptScroll ?? null}
          defaultScrollToBottom={defaultChatScrollToBottom}
          onScrollSnapshot={onChatScrollSnapshot}
          onLoadOlder={onLoadOlderMessages}
          onOpenToolFile={scope.openSessionFilePreview}
          onWebMenuOpenChange={controller.onWebMenuOpenChange}
          onMessageMenuAction={controller.onWebMessageMenuAction}
          keyboardLiftNonce={keyboardLiftNonce}
        />
      ) : (
        <MessageList
          key={chatScrollKey ?? 'no-session-scroll'}
          messages={chatMessages}
          streamingText={streamingText}
          streamingThinking={streamingThinking}
          toolInvoking={uiRunning}
          agentRunning={agentActive}
          chatRichTextEnabled={chatRichTextEnabled}
          richRenderEpoch={richRenderEpoch}
          initialScroll={cachedChatScroll ?? null}
          defaultScrollToBottom={defaultChatScrollToBottom}
          onScrollSnapshot={onChatScrollSnapshot}
          onMessageLongPress={controller.handleMessageLongPress}
          onOpenToolFile={scope.openSessionFilePreview}
          keyboardLiftNonce={keyboardLiftNonce}
          listHeaderComponent={
            hasMoreMessages ? (
              <Pressable
                style={styles.loadMoreBtn}
                onPress={onLoadOlderMessages}
              >
                <Text style={{ color: tokens.primary }}>
                  {loadingMoreMessages ? '加载中…' : '加载更早消息'}
                </Text>
              </Pressable>
            ) : null
          }
        />
      )
    ) : null;
  const chatComposer =
    projectId != null && sessionId != null ? (
      <ChatComposer
        scope={{ projectId, sessionId }}
        hasModel={hasWorkspaceModel || agentMeta.hasDedicatedModel}
        running={uiRunning}
        beginUiRun={beginUiRun}
        abortUiRun={abortUiRun}
        onStreamReset={onStreamReset}
        onMessagesChanged={onMessagesChanged}
        onNeedModel={onNeedModel}
        canResumeWithoutInput={canResumeWithoutInput}
        lastMessageHasToolResult={lastMessageHasToolResult}
        lastMessageIsPlainUserText={lastMessageIsPlainUserText}
        draftRestoreToken={draftRestoreToken}
        onOpenMore={() => setSessionDrawerOpen(true)}
      />
    ) : null;

  return (
    <View
      style={[styles.subviewFill, !visible && styles.panelHidden]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <SegmentedControl
        tokens={tokens}
        value={conversationPanel}
        onChange={setConversationPanel}
        options={[
          { value: 'chat', label: '聊天', testID: 'tab-chat' },
          { value: 'workspace', label: '聊天工作区', testID: 'tab-workspace' },
        ]}
      />
      {projectId != null && sessionId != null ? (
        <>
          {Platform.OS === 'android' ? (
            <AndroidKeyboardChatBody
              style={chatPanelStyle}
              pointerEvents={chatPointerEvents}
              header={chatHeader}
              transcript={chatTranscript}
              composer={chatComposer}
              onKeyboardLifted={onKeyboardLifted}
            />
          ) : (
            <View style={chatPanelStyle} pointerEvents={chatPointerEvents}>
              {chatHeader}
              <View style={styles.transcriptHost}>{chatTranscript}</View>
              {chatComposer}
            </View>
          )}
          {sessionVfs && sessionWorktree ? (
            <View
              style={[
                styles.flexFill,
                conversationPanel !== 'workspace' && styles.panelHidden,
              ]}
              pointerEvents={
                conversationPanel === 'workspace' ? 'auto' : 'none'
              }
            >
              <VfsFileManager
                ref={workspaceVfsRef}
                key={`session-vfs-${vfsRefreshKey}`}
                scope={sessionVfsScope!}
                vfs={sessionVfs}
                workplace={sessionWorktree}
                rootPath="/"
                pullFromParent={{
                  scope: { kind: 'session', sessionId },
                  onPulled: bumpWorktreeUiToken,
                }}
                onOpenFile={path => onOpenFileEditor(path, 'session')}
                onDirectoryChange={emitWorkspaceBackState}
              />
            </View>
          ) : conversationPanel === 'workspace' ? (
            <View style={styles.placeholder}>
              <Text style={{ color: tokens.textSecondary }}>
                聊天工作区不可用
              </Text>
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.placeholder}>
          <Text style={{ color: tokens.textSecondary }}>请先选择会话</Text>
        </View>
      )}
      <SessionActionsDrawer
        visible={sessionDrawerOpen}
        onClose={() => setSessionDrawerOpen(false)}
        onRename={() => {
          if (sessionId != null) {
            setSessionDrawerOpen(false);
            scope.openSessionRenamePrompt(sessionId);
          }
        }}
        onCompact={() => {
          setSessionDrawerOpen(false);
          controller.handleCompactSession();
        }}
        onRealPrompt={controller.onNavigateRealPrompt}
        onSwitchModel={() => setModelPickerOpen(true)}
        onSwitchAgent={() => setAgentPickerOpen(true)}
      />
      <MessageActionMenu
        visible={!useWebviewTranscript && messageMenuTarget != null}
        anchor={messageMenuAnchor}
        items={controller.messageMenuItems}
        onClose={controller.closeMessageMenu}
        onSelect={controller.onMessageMenuSelect}
      />
      <MessageEditModal
        visible={messageEditPrompt != null}
        title="编辑消息"
        label="内容"
        placeholder="输入消息内容"
        initialValue={messageEditPrompt?.initialText ?? ''}
        confirmLabel="保存"
        onClose={() => setMessageEditPrompt(undefined)}
        onConfirm={async value => {
          const prompt = messageEditPrompt;
          setMessageEditPrompt(undefined);
          if (prompt) {
            await controller.handleSaveMessageEdit(prompt.messageId, value);
          }
        }}
      />
      <ModelPickerModal
        visible={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        onSelected={onRefreshChatMeta}
      />
      <AgentPickerModal
        visible={agentPickerOpen}
        onClose={() => setAgentPickerOpen(false)}
        onSelected={onRefreshChatMeta}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  subviewFill: { flex: 1, minHeight: 0 },
  panelHidden: { display: 'none' },
  chatPanel: { flex: 1 },
  transcriptHost: { flex: 1, minHeight: 0 },
  flexFill: { flex: 1 },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadMoreBtn: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
  },
});
