/**
 * Chat tab conversation subview: transcript, composer, session workspace.
 */
import React, {useCallback, useEffect, useMemo} from 'react';
import {Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import {type VfsScope} from '@novel-master/core/vfs';
import {AgentPickerModal} from '@/components/agent/AgentPickerModal';
import {ChatComposer} from '@/components/chat/ChatComposer';
import {ChatMetaBar} from '@/components/chat/ChatMetaBar';
import {ChatStreamMetricsBarLive} from '@/components/chat/ChatStreamMetricsBarLive';
import {ChatTranscriptWebView} from '@/components/chat/ChatTranscriptWebView';
import {MessageActionMenu} from '@/components/chat/MessageActionMenu';
import {MessageEditModal} from '@/components/chat/MessageEditModal';
import {MessageList} from '@/components/chat/MessageList';
import {ModelPickerModal} from '@/components/provider/ModelPickerModal';
import {BottomSheetMenu} from '@/components/sheet/BottomSheetMenu';
import {VfsFileManager} from '@/components/vfs/VfsFileManager';
import {SegmentedControl} from '@/components/ui/SegmentedControl';
import {AndroidKeyboardClipBody} from '@/components/chrome/AndroidKeyboardClipBody';
import {useToast} from '@/components/chrome/ToastHost';
import {
  AGENT_LOCK_TOAST_GUIDE,
  isAgentLocked,
  isModelLocked,
  MODEL_LOCK_TOAST,
} from '@/services/chat-agent-meta';
import type {ThemeTokens} from '@/theme/tokens';
import {useChatTabContext} from './ChatTabProvider';
import {useChatTabWorkspaceBackState} from './ChatTabNavigationProvider';
import {useChatTabController} from './useChatTabController';

export type ChatConversationPanelProps = {
  tokens: ThemeTokens;
  visible: boolean;
};

/**
 * Android：消息区 + 输入框共用同一套 Reanimated 动画（与 KeyboardStickyView 同源 height），
 * 裁切抬升由 AndroidKeyboardClipBody 统一持有（screens/C-2），这里只负责
 * 把 header 放在裁切窗口外、transcript/composer 放进去；iOS 分支结构一致、
 * 不套裁切容器。
 */

export function ChatConversationPanel({
  tokens,
  visible,
}: ChatConversationPanelProps) {
  const ctx = useChatTabContext();
  const controller = useChatTabController();
  const setWorkspaceBackState = useChatTabWorkspaceBackState();
  const {showToast} = useToast();
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
    pendingSubagentSessions,
    richRenderEpoch,
    webMenuCloseSignal,
    mermaidViewerCloseSignal,
    restoredTranscriptScroll,
    defaultChatScrollToBottom,
    cachedChatScroll,
    streamingText,
    streamingThinking,
    loadingMoreMessages,
    hasWorkspaceModel,
    canResumeWithoutInput,
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
    endUiRunOnError,
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
    return {kind: 'session', projectId, sessionId};
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

  // 顶部 meta 条点 agent / model 名 → 判锁定后开对应 picker，判据统一走 helper，
  // 不再各处手写 source/modelSource/hasDedicatedModel 的组合。
  const openAgentPicker = useCallback(() => {
    if (isAgentLocked(agentMeta)) {
      showToast(AGENT_LOCK_TOAST_GUIDE);
      return;
    }
    setAgentPickerOpen(true);
  }, [agentMeta, showToast, setAgentPickerOpen]);

  const openModelPicker = useCallback(() => {
    if (isModelLocked(agentMeta)) {
      showToast(MODEL_LOCK_TOAST);
      return;
    }
    setModelPickerOpen(true);
  }, [agentMeta, showToast, setModelPickerOpen]);

  const chatPanelStyle = [
    styles.chatPanel,
    conversationPanel !== 'chat' && styles.panelHidden,
  ];
  const chatPointerEvents =
    conversationPanel === 'chat' ? ('auto' as const) : ('none' as const);
  const chatHeader =
    projectId != null && sessionId != null ? (
      <>
        <ChatMetaBar
          meta={agentMeta}
          onPressAgent={openAgentPicker}
          onPressModel={openModelPicker}
        />
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
          mermaidViewerCloseSignal={mermaidViewerCloseSignal}
          initialScroll={restoredTranscriptScroll ?? null}
          defaultScrollToBottom={defaultChatScrollToBottom}
          onScrollSnapshot={onChatScrollSnapshot}
          onLoadOlder={onLoadOlderMessages}
          onOpenToolFile={scope.openSessionFilePreview}
          onOpenSubagentSession={scope.openSubagentSession}
          onOpenSkillDetail={scope.openSkillDetail}
          pendingSubagentSessions={pendingSubagentSessions}
          onWebMenuOpenChange={controller.onWebMenuOpenChange}
          onWebMermaidViewerOpenChange={ctx.setMermaidViewerOpen}
          onMessageMenuAction={controller.onWebMessageMenuAction}
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
          onOpenSubagentSession={scope.openSubagentSession}
          onOpenSkillDetail={scope.openSkillDetail}
          pendingSubagentSessions={pendingSubagentSessions}
          listHeaderComponent={
            hasMoreMessages ? (
              <Pressable
                style={styles.loadMoreBtn}
                onPress={onLoadOlderMessages}
              >
                <Text style={{color: tokens.primary}}>
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
        scope={{projectId, sessionId}}
        hasModel={hasWorkspaceModel || agentMeta.hasDedicatedModel}
        running={uiRunning}
        beginUiRun={beginUiRun}
        endUiRunOnError={endUiRunOnError}
        abortUiRun={abortUiRun}
        onStreamReset={onStreamReset}
        onMessagesChanged={onMessagesChanged}
        onNeedModel={onNeedModel}
        canResumeWithoutInput={canResumeWithoutInput}
        lastMessageIsPlainUserText={lastMessageIsPlainUserText}
        draftRestoreToken={draftRestoreToken}
        // 「更多」按钮已在 ChatComposer 内注释隐藏，这里不再传 onOpenMore，
        // 避免传了却没人响应造成误解。压缩/切换等入口改由会话详情页抽屉承担。
        // onOpenMore={() => setSessionDrawerOpen(true)}
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
          {value: 'chat', label: '聊天', testID: 'tab-chat'},
          {value: 'workspace', label: '聊天工作区', testID: 'tab-workspace'},
        ]}
      />
      {projectId != null && sessionId != null ? (
        <>
          {Platform.OS === 'android' ? (
            <View style={chatPanelStyle} pointerEvents={chatPointerEvents}>
              {chatHeader}
              <AndroidKeyboardClipBody>
                <View style={styles.transcriptHost}>{chatTranscript}</View>
                {chatComposer}
              </AndroidKeyboardClipBody>
            </View>
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
                  scope: {kind: 'session', sessionId},
                  onPulled: bumpWorktreeUiToken,
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
      <BottomSheetMenu
        visible={sessionDrawerOpen}
        title="会话操作"
        items={[
          {
            label: '查看提示词',
            action: 'real-prompt',
            disabled: controller.onNavigateRealPrompt == null,
          },
          {label: '压缩上下文', action: 'compact'},
          {label: '切换大模型', action: 'switch-model'},
          {label: '切换智能体', action: 'switch-agent'},
        ]}
        onClose={() => setSessionDrawerOpen(false)}
        onSelect={action => {
          if (action === 'real-prompt') {
            controller.onNavigateRealPrompt?.();
          } else if (action === 'compact') {
            controller.handleCompactSession();
          } else if (action === 'switch-model') {
            setModelPickerOpen(true);
          } else if (action === 'switch-agent') {
            setAgentPickerOpen(true);
          }
        }}
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
        sessionId={sessionId}
        visible={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        onSelected={onRefreshChatMeta}
      />
      <AgentPickerModal
        sessionId={sessionId}
        visible={agentPickerOpen}
        onClose={() => setAgentPickerOpen(false)}
        onSelected={onRefreshChatMeta}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  subviewFill: {flex: 1, minHeight: 0},
  panelHidden: {display: 'none'},
  chatPanel: {flex: 1, backgroundColor: 'transparent'},
  transcriptHost: {flex: 1, minHeight: 0},
  flexFill: {flex: 1},
  placeholder: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  loadMoreBtn: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
  },
});
