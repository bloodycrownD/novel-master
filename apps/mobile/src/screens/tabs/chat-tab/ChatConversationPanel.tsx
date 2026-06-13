/**
 * Chat tab conversation subview: transcript, composer, session workspace.
 */
import React, {useCallback, useEffect, useMemo} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {
  AgentRunFinishedPayload,
  AgentStepCommittedPayload,
  ChatMessage,
  VfsScope,
  VfsService,
  WorktreeService,
} from '@novel-master/core';
import {AgentPickerModal} from '../../../components/agent/AgentPickerModal';
import {ChatComposer} from '../../../components/chat/ChatComposer';
import {ChatMetaBar} from '../../../components/chat/ChatMetaBar';
import {
  ChatTranscriptWebView,
  type ChatTranscriptWebViewHandle,
} from '../../../components/chat/ChatTranscriptWebView';
import type {ChatTranscriptScrollSnapshot} from '../../../components/chat/ChatTranscriptBridge';
import {
  MessageActionMenu,
  type MessageActionMenuItem,
} from '../../../components/chat/MessageActionMenu';
import {MessageEditModal} from '../../../components/chat/MessageEditModal';
import {MessageList} from '../../../components/chat/MessageList';
import {MessageBatchHeader} from '../../../components/batch/MessageBatchHeader';
import {ModelPickerModal} from '../../../components/provider/ModelPickerModal';
import {SessionActionsDrawer} from '../../../components/chrome/SessionActionsDrawer';
import {
  VfsFileManager,
  type VfsFileManagerHandle,
} from '../../../components/vfs/VfsFileManager';
import {SegmentedControl} from '../../../components/ui/SegmentedControl';
import type {MessageMenuAnchor} from '../../../components/chat/MessageActionMenu';
import type {ChatListScrollSnapshot} from '../../../services/chat-list-scroll-cache';
import type {ChatAgentMeta} from '../../../services/chat-agent-meta';
import type {ThemeTokens} from '../../../theme/tokens';
import type {ConversationPanel} from './useChatTabScope';

export type ChatConversationPanelProps = {
  tokens: ThemeTokens;
  visible: boolean;
  conversationPanel: ConversationPanel;
  onConversationPanelChange: (panel: ConversationPanel) => void;
  projectId: string | undefined;
  sessionId: string | undefined;
  agentMeta: ChatAgentMeta;
  toolInvoking: boolean;
  messageBatchActive: boolean;
  messageBatchSelectedCount: number;
  messageBatchSelectedIds: ReadonlySet<string>;
  onExitMessageBatch: () => void;
  onConfirmMessageBatchDelete: () => void;
  onConfirmBatchHideMessages: () => void;
  onConfirmBatchUnhideMessages: () => void;
  useWebviewTranscript: boolean;
  transcriptWebRef: React.RefObject<ChatTranscriptWebViewHandle | null>;
  chatScrollKey: string | null;
  chatMessages: ChatMessage[];
  hasMoreMessages: boolean;
  agentRunning: boolean;
  transcriptFlags: {richText: boolean; batchMode: boolean};
  webMenuCloseSignal: number;
  restoredTranscriptScroll: ChatTranscriptScrollSnapshot | undefined;
  defaultChatScrollToBottom: boolean;
  cachedChatScroll: ChatListScrollSnapshot | ChatTranscriptScrollSnapshot | undefined;
  streamingText: string;
  streamingThinking: string;
  chatRichTextEnabled: boolean;
  richRenderEpoch: number;
  loadingMoreMessages: boolean;
  hasWorkspaceModel: boolean;
  canResumeWithoutInput: boolean;
  vfsRefreshKey: number;
  sessionVfs: VfsService | null;
  sessionWorktree: WorktreeService | null;
  sessionDrawerOpen: boolean;
  onCloseSessionDrawer: () => void;
  onOpenSessionRename: () => void;
  onCompactSession: () => void;
  onNavigateRealPrompt: () => void;
  onEnterMessageBatch: () => void;
  modelPickerOpen: boolean;
  agentPickerOpen: boolean;
  onCloseModelPicker: () => void;
  onCloseAgentPicker: () => void;
  onRefreshChatMeta: () => void;
  messageMenuTarget: ChatMessage | undefined;
  messageMenuAnchor: MessageMenuAnchor | undefined;
  messageMenuItems: readonly MessageActionMenuItem[];
  useWebviewMessageMenu: boolean;
  onCloseMessageMenu: () => void;
  onMessageMenuSelect: (action: string) => void;
  messageEditPrompt: {messageId: string; initialText: string} | undefined;
  onCloseMessageEdit: () => void;
  onSaveMessageEdit: (messageId: string, value: string) => Promise<void>;
  onChatScrollSnapshot: (
    snap: ChatListScrollSnapshot | ChatTranscriptScrollSnapshot,
  ) => void;
  onLoadOlderMessages: () => void;
  onOpenSessionFilePreview: (path: string) => void;
  onWebMenuOpenChange: (open: boolean) => void;
  onWebMessageMenuAction: (messageId: string, action: string) => void;
  onToggleMessageSelect: (messageId: string) => void;
  onMessageLongPress: (msg: ChatMessage, anchor: MessageMenuAnchor) => void;
  onAgentRunningChange: (running: boolean) => void;
  onStreamText: (delta: string) => void;
  onStreamThinking: (delta: string) => void;
  onStreamReset: () => void;
  onMessagesChanged: () => void;
  onStepCommitted: (payload: AgentStepCommittedPayload) => void;
  onRunFinished: (payload: AgentRunFinishedPayload) => void;
  onNeedModel: () => void;
  bumpVfsRefresh: () => void;
  onOpenFileEditor: (path: string, scopeKind: 'project' | 'session') => void;
  workspaceVfsRef?: React.RefObject<VfsFileManagerHandle | null>;
  onWorkspaceBackStateChange?: (
    state: {canGoUp: boolean; goUp: () => void} | null,
  ) => void;
};

export function ChatConversationPanel({
  tokens,
  visible,
  conversationPanel,
  onConversationPanelChange,
  projectId,
  sessionId,
  agentMeta,
  toolInvoking,
  messageBatchActive,
  messageBatchSelectedCount,
  messageBatchSelectedIds,
  onExitMessageBatch,
  onConfirmMessageBatchDelete,
  onConfirmBatchHideMessages,
  onConfirmBatchUnhideMessages,
  useWebviewTranscript,
  transcriptWebRef,
  chatScrollKey,
  chatMessages,
  hasMoreMessages,
  agentRunning,
  transcriptFlags,
  webMenuCloseSignal,
  restoredTranscriptScroll,
  defaultChatScrollToBottom,
  cachedChatScroll,
  streamingText,
  streamingThinking,
  chatRichTextEnabled,
  richRenderEpoch,
  loadingMoreMessages,
  hasWorkspaceModel,
  canResumeWithoutInput,
  vfsRefreshKey,
  sessionVfs,
  sessionWorktree,
  sessionDrawerOpen,
  onCloseSessionDrawer,
  onOpenSessionRename,
  onCompactSession,
  onNavigateRealPrompt,
  onEnterMessageBatch,
  modelPickerOpen,
  agentPickerOpen,
  onCloseModelPicker,
  onCloseAgentPicker,
  onRefreshChatMeta,
  messageMenuTarget,
  messageMenuAnchor,
  messageMenuItems,
  useWebviewMessageMenu,
  onCloseMessageMenu,
  onMessageMenuSelect,
  messageEditPrompt,
  onCloseMessageEdit,
  onSaveMessageEdit,
  onChatScrollSnapshot,
  onLoadOlderMessages,
  onOpenSessionFilePreview,
  onWebMenuOpenChange,
  onWebMessageMenuAction,
  onToggleMessageSelect,
  onMessageLongPress,
  onAgentRunningChange,
  onStreamText,
  onStreamThinking,
  onStreamReset,
  onMessagesChanged,
  onStepCommitted,
  onRunFinished,
  onNeedModel,
  bumpVfsRefresh,
  onOpenFileEditor,
  workspaceVfsRef,
  onWorkspaceBackStateChange,
}: ChatConversationPanelProps) {
  const sessionVfsScope = useMemo((): VfsScope | null => {
    if (projectId == null || sessionId == null) {
      return null;
    }
    return {kind: 'session', projectId, sessionId};
  }, [projectId, sessionId]);

  const emitWorkspaceBackState = useCallback(() => {
    if (!onWorkspaceBackStateChange) {
      return;
    }
    if (conversationPanel !== 'workspace') {
      onWorkspaceBackStateChange(null);
      return;
    }
    const handle = workspaceVfsRef?.current;
    if (!handle) {
      onWorkspaceBackStateChange(null);
      return;
    }
    onWorkspaceBackStateChange({
      canGoUp: handle.canGoUp(),
      goUp: () => handle.goUp(),
    });
  }, [conversationPanel, onWorkspaceBackStateChange, workspaceVfsRef]);

  useEffect(() => {
    emitWorkspaceBackState();
  }, [emitWorkspaceBackState, vfsRefreshKey]);

  return (
    <View
      style={[styles.subviewFill, !visible && styles.panelHidden]}
      pointerEvents={visible ? 'auto' : 'none'}>
      <SegmentedControl
        tokens={tokens}
        value={conversationPanel}
        onChange={onConversationPanelChange}
        options={[
          {value: 'chat', label: '聊天', testID: 'tab-chat'},
          {value: 'workspace', label: '聊天工作区', testID: 'tab-workspace'},
        ]}
      />
      {projectId != null && sessionId != null ? (
        <>
          <View
            style={[
              styles.chatPanel,
              conversationPanel !== 'chat' && styles.panelHidden,
            ]}
            pointerEvents={conversationPanel === 'chat' ? 'auto' : 'none'}>
            <ChatMetaBar meta={agentMeta} />
            {messageBatchActive ? (
              <MessageBatchHeader
                selectedCount={messageBatchSelectedCount}
                onCancel={onExitMessageBatch}
                onDelete={onConfirmMessageBatchDelete}
                onHide={onConfirmBatchHideMessages}
                onRestore={onConfirmBatchUnhideMessages}
              />
            ) : null}
            {useWebviewTranscript ? (
              <ChatTranscriptWebView
                ref={transcriptWebRef}
                key={chatScrollKey ?? 'no-session-scroll'}
                sessionKey={chatScrollKey ?? 'no-session'}
                messages={chatMessages}
                hasMore={hasMoreMessages}
                agentRunning={agentRunning}
                toolInvoking={toolInvoking}
                flags={transcriptFlags}
                selectedMessageIds={messageBatchSelectedIds}
                menuCloseSignal={webMenuCloseSignal}
                initialScroll={restoredTranscriptScroll ?? null}
                defaultScrollToBottom={defaultChatScrollToBottom}
                onScrollSnapshot={onChatScrollSnapshot}
                onLoadOlder={onLoadOlderMessages}
                onOpenToolFile={onOpenSessionFilePreview}
                onWebMenuOpenChange={onWebMenuOpenChange}
                onMessageMenuAction={onWebMessageMenuAction}
                onToggleMessageSelect={onToggleMessageSelect}
              />
            ) : (
              /* legacy-rn engine fallback — see chat-transcript-engine.ts + README */
              <MessageList
                key={chatScrollKey ?? 'no-session-scroll'}
                messages={chatMessages}
                streamingText={streamingText}
                streamingThinking={streamingThinking}
                toolInvoking={toolInvoking}
                agentRunning={agentRunning}
                chatRichTextEnabled={chatRichTextEnabled}
                richRenderEpoch={richRenderEpoch}
                initialScroll={cachedChatScroll ?? null}
                defaultScrollToBottom={defaultChatScrollToBottom}
                onScrollSnapshot={onChatScrollSnapshot}
                batchMode={messageBatchActive}
                selectedMessageIds={messageBatchSelectedIds}
                onToggleMessageSelect={onToggleMessageSelect}
                onMessageLongPress={onMessageLongPress}
                onOpenToolFile={onOpenSessionFilePreview}
                listHeaderComponent={
                  hasMoreMessages ? (
                    <Pressable
                      style={styles.loadMoreBtn}
                      onPress={onLoadOlderMessages}>
                      <Text style={{color: tokens.primary}}>
                        {loadingMoreMessages ? '加载中…' : '加载更早消息'}
                      </Text>
                    </Pressable>
                  ) : null
                }
              />
            )}
            <ChatComposer
              scope={{projectId, sessionId}}
              hasModel={hasWorkspaceModel || agentMeta.hasDedicatedModel}
              running={agentRunning}
              onRunningChange={running => {
                onAgentRunningChange(running);
                setMobileAgentActive(running);
              }}
              onStreamText={onStreamText}
              onStreamThinking={onStreamThinking}
              onStreamReset={onStreamReset}
              onMessagesChanged={onMessagesChanged}
              onStepCommitted={onStepCommitted}
              onRunFinished={onRunFinished}
              onNeedModel={onNeedModel}
              canResumeWithoutInput={canResumeWithoutInput}
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
              }>
              <VfsFileManager
                ref={workspaceVfsRef}
                key={`session-vfs-${vfsRefreshKey}`}
                scope={sessionVfsScope!}
                vfs={sessionVfs}
                worktree={sessionWorktree}
                rootPath="/"
                pullFromParent={{
                  scope: {kind: 'session', sessionId},
                  onPulled: bumpVfsRefresh,
                }}
                onOpenFile={path => onOpenFileEditor(path, 'session')}
                onDirectoryChange={emitWorkspaceBackState}
              />
            </View>
          ) : conversationPanel === 'workspace' ? (
            <View style={styles.placeholder}>
              <Text style={{color: tokens.textSecondary}}>
                聊天工作区不可用
              </Text>
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.placeholder}>
          <Text style={{color: tokens.textSecondary}}>请先选择会话</Text>
        </View>
      )}
      <SessionActionsDrawer
        visible={sessionDrawerOpen}
        onClose={onCloseSessionDrawer}
        onRename={onOpenSessionRename}
        onCompact={onCompactSession}
        onRealPrompt={onNavigateRealPrompt}
        onBatchMessages={onEnterMessageBatch}
      />
      <MessageActionMenu
        visible={useWebviewMessageMenu && messageMenuTarget != null}
        anchor={messageMenuAnchor}
        items={messageMenuItems}
        onClose={onCloseMessageMenu}
        onSelect={onMessageMenuSelect}
      />
      <MessageEditModal
        visible={messageEditPrompt != null}
        title="编辑消息"
        label="内容"
        placeholder="输入消息内容"
        initialValue={messageEditPrompt?.initialText ?? ''}
        confirmLabel="保存"
        onClose={onCloseMessageEdit}
        onConfirm={async value => {
          const prompt = messageEditPrompt;
          onCloseMessageEdit();
          if (prompt) {
            await onSaveMessageEdit(prompt.messageId, value);
          }
        }}
      />
      <ModelPickerModal
        visible={modelPickerOpen}
        onClose={onCloseModelPicker}
        onSelected={onRefreshChatMeta}
      />
      <AgentPickerModal
        visible={agentPickerOpen}
        onClose={onCloseAgentPicker}
        onSelected={onRefreshChatMeta}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  subviewFill: {flex: 1, minHeight: 0},
  panelHidden: {display: 'none'},
  chatPanel: {flex: 1},
  flexFill: {flex: 1},
  placeholder: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  loadMoreBtn: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
  },
});
