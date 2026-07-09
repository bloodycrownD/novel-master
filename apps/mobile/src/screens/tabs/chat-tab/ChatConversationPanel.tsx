/**
 * Chat tab conversation subview: transcript, composer, session workspace.
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { type ChatMessage } from '@novel-master/core/chat';
import { type VfsScope } from '@novel-master/core/vfs';
import { AgentPickerModal } from '@/components/agent/AgentPickerModal';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { ChatMetaBar } from '@/components/chat/ChatMetaBar';
import { ChatStreamMetricsBarLive } from '@/components/chat/ChatStreamMetricsBarLive';
import { ChatTranscriptWebView } from '@/components/chat/ChatTranscriptWebView';
import {
  MessageActionMenu,
} from '@/components/chat/MessageActionMenu';
import { MessageEditModal } from '@/components/chat/MessageEditModal';
import { MessageList } from '@/components/chat/MessageList';
import { MessageBatchHeader } from '@/components/batch/MessageBatchHeader';
import {
  computeHideRangeFromSelection,
  computeVisibilityBatchAffectedIds,
} from '@/components/chat/transcript-selectable-role';
import {
  chatMessagesToTailBatchRows,
  computeTailBatchAffectedIds,
  computeTailBatchRangeFromSelection,
} from '@/components/chat/transcript-selectable-role';
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

export function ChatConversationPanel({ tokens, visible }: ChatConversationPanelProps) {
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
    streamTailGenerating,
    uiRunning,
    agentActive,
    messageBatchActive,
    messageBatchMode,
    messageBatchSelectedCount,
    messageBatchSelectedIds,
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
      batchMode: messageBatchActive,
      batchModeKind: messageBatchMode,
    }),
    [chatRichTextEnabled, messageBatchActive, messageBatchMode],
  );

  const sessionVfsScope = useMemo((): VfsScope | null => {
    if (projectId == null || sessionId == null) {
      return null;
    }
    return { kind: 'session', projectId, sessionId };
  }, [projectId, sessionId]);

  const visibilityBatchPreview = useMemo(() => {
    if (messageBatchMode == null) {
      return {
        affectedIds: new Set<string>() as ReadonlySet<string>,
        affectedCount: 0,
        rangeLabel: null as string | null,
      };
    }
    const sessionMaxSeq =
      chatMessages.length > 0 ? Math.max(...chatMessages.map(m => m.seq)) : 0;
    if (messageBatchMode === 'hide') {
      const affectedIds = computeVisibilityBatchAffectedIds(
        chatMessages,
        messageBatchMode,
        messageBatchSelectedIds,
        sessionMaxSeq,
      );
      if (affectedIds.size === 0) {
        return { affectedIds, affectedCount: 0, rangeLabel: null };
      }
      const range = computeHideRangeFromSelection(
        chatMessages,
        messageBatchSelectedIds,
      );
      return {
        affectedIds,
        affectedCount: affectedIds.size,
        rangeLabel: range != null ? `seq 1–${range.toSeq}` : null,
      };
    }
    const tailRows = chatMessagesToTailBatchRows(chatMessages);
    const affectedIds = computeTailBatchAffectedIds(
      tailRows,
      messageBatchSelectedIds,
      sessionMaxSeq,
    );
    if (affectedIds.size === 0) {
      return { affectedIds, affectedCount: 0, rangeLabel: null };
    }
    const range = computeTailBatchRangeFromSelection(
      tailRows,
      messageBatchSelectedIds,
      sessionMaxSeq,
      messageBatchMode,
    );
    return {
      affectedIds,
      affectedCount: affectedIds.size,
      rangeLabel: range != null ? `seq ${range.fromSeq}–末` : null,
    };
  }, [chatMessages, messageBatchMode, messageBatchSelectedIds]);

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
          <View
            style={[
              styles.chatPanel,
              conversationPanel !== 'chat' && styles.panelHidden,
            ]}
            pointerEvents={conversationPanel === 'chat' ? 'auto' : 'none'}
          >
            <ChatMetaBar meta={agentMeta} />
            <ChatStreamMetricsBarLive
              agentRunning={uiRunning}
              accRef={streamMetricsAccRef}
              lastRun={streamMetricsLastRun}
            />
            {messageBatchActive && messageBatchMode != null ? (
              <MessageBatchHeader
                tokens={tokens}
                mode={messageBatchMode}
                selectedCount={messageBatchSelectedCount}
                affectedCount={visibilityBatchPreview.affectedCount}
                rangeLabel={visibilityBatchPreview.rangeLabel}
                onCancel={controller.exitMessageBatch}
                onConfirm={controller.confirmVisibilityBatch}
              />
            ) : null}
            {useWebviewTranscript ? (
              <ChatTranscriptWebView
                ref={transcriptWebRef}
                key={chatScrollKey ?? 'no-session-scroll'}
                sessionKey={chatScrollKey ?? 'no-session'}
                messages={chatMessages}
                hasMore={hasMoreMessages}
                agentRunning={agentActive}
                uiRunning={uiRunning}
                toolInvoking={streamTailGenerating}
                flags={transcriptFlags}
                selectedMessageIds={messageBatchSelectedIds}
                affectedMessageIds={visibilityBatchPreview.affectedIds}
                menuCloseSignal={webMenuCloseSignal}
                initialScroll={restoredTranscriptScroll ?? null}
                defaultScrollToBottom={defaultChatScrollToBottom}
                onScrollSnapshot={onChatScrollSnapshot}
                onLoadOlder={onLoadOlderMessages}
                onOpenToolFile={scope.openSessionFilePreview}
                onWebMenuOpenChange={controller.onWebMenuOpenChange}
                onMessageMenuAction={controller.onWebMessageMenuAction}
                onToggleMessageSelect={controller.handleToggleMessageSelect}
              />
            ) : (
              <MessageList
                key={chatScrollKey ?? 'no-session-scroll'}
                messages={chatMessages}
                streamingText={streamingText}
                streamingThinking={streamingThinking}
                toolInvoking={streamTailGenerating}
                agentRunning={agentActive}
                chatRichTextEnabled={chatRichTextEnabled}
                richRenderEpoch={richRenderEpoch}
                initialScroll={cachedChatScroll ?? null}
                defaultScrollToBottom={defaultChatScrollToBottom}
                onScrollSnapshot={onChatScrollSnapshot}
                batchMode={messageBatchActive ? messageBatchMode : null}
                selectedMessageIds={messageBatchSelectedIds}
                affectedMessageIds={visibilityBatchPreview.affectedIds}
                onToggleMessageSelect={controller.handleToggleMessageSelect}
                onMessageLongPress={controller.handleMessageLongPress}
                onOpenToolFile={scope.openSessionFilePreview}
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
            )}
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
            />
          </View>
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
                worktree={sessionWorktree}
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
        onHideMessages={() => {
          setSessionDrawerOpen(false);
          controller.enterHideMessageBatch();
        }}
        onRestoreMessages={() => {
          setSessionDrawerOpen(false);
          controller.enterRestoreMessageBatch();
        }}
        onDeleteMessages={() => {
          setSessionDrawerOpen(false);
          controller.enterDeleteMessageBatch();
        }}
        onRefreshWorktree={controller.handleRefreshWorktree}
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
  flexFill: { flex: 1 },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadMoreBtn: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
  },
});
