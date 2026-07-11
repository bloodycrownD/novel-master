/**
 * Chat tab 低频回调：消息菜单、工作区导航等。
 */
import { useCallback } from 'react';
import { Alert } from 'react-native';
import { buildMessageActionItems } from '@/components/chat/message-edit';
import { invalidateSessionWorktreeSnapshot } from '@/services/worktree-snapshot.service';
import { useChatTabContext } from './ChatTabProvider';
import { useChatTabMessageActions } from './useChatTabMessages';

export function useChatTabController() {
  const ctx = useChatTabContext();

  const messageActions = useChatTabMessageActions({
    runtime: ctx.runtime,
    projectId: ctx.projectId,
    sessionId: ctx.sessionId,
    messages: ctx.messages,
    agentRunning: ctx.uiRunning,
    resetStreamingDisplay: ctx.resetStreamingDisplay,
    showToast: ctx.showToast,
    refreshChatTokenLabel: ctx.scope.refreshChatTokenLabel,
    bumpWorktreeUiToken: ctx.bumpWorktreeUiToken,
    reloadLists: ctx.scope.reloadLists,
    setCurrentSession: ctx.setCurrentSession,
    setChatSubview: ctx.setChatSubview,
    setConversationPanel: ctx.setConversationPanel,
    setMessageEditPrompt: ctx.setMessageEditPrompt,
  });

  const handleMessageLongPress = useCallback(
    (
      msg: import('@novel-master/core/chat').ChatMessage,
      anchor: import('@/components/chat/MessageActionMenu').MessageMenuAnchor,
    ) => {
      if (ctx.uiRunning) {
        return;
      }
      ctx.setMessageMenuTarget(msg);
      ctx.setMessageMenuAnchor(anchor);
    },
    [ctx],
  );

  const handleRefreshWorktree = useCallback(() => {
    if (ctx.projectId == null || ctx.sessionId == null) {
      return;
    }
    invalidateSessionWorktreeSnapshot(
      ctx.runtime,
      ctx.projectId,
      ctx.sessionId,
    );
    ctx.showToast('工作树快照已标记刷新');
  }, [ctx]);

  const onNavigateRealPrompt = useCallback(() => {
    ctx.navigation.navigate('RealPrompt');
  }, [ctx]);

  const onWebMenuOpenChange = useCallback(
    (open: boolean) => {
      ctx.setWebMenuOpen(open);
      if (!open) {
        ctx.setMessageMenuTarget(undefined);
        ctx.setMessageMenuAnchor(undefined);
      }
    },
    [ctx],
  );

  const onWebMessageMenuAction = useCallback(
    (messageId: string, action: string) => {
      const target = ctx.chatMessages.find(m => m.id === messageId);
      if (target == null) {
        return;
      }
      messageActions.handleMessageMenuAction(target, action);
    },
    [ctx, messageActions],
  );

  const onMessageMenuSelect = useCallback(
    (action: string) => {
      const target = ctx.messageMenuTarget;
      ctx.closeMessageMenu();
      if (target == null) {
        return;
      }
      messageActions.handleMessageMenuAction(target, action);
    },
    [ctx, messageActions],
  );

  const messageMenuItems =
    ctx.messageMenuTarget != null
      ? buildMessageActionItems(ctx.messageMenuTarget)
      : [];

  const confirmBatchDeleteSessions = useCallback(
    (count: number, onConfirm: () => void) => {
      if (count === 0) {
        return;
      }
      Alert.alert('确认删除', `确定删除选中的 ${count} 个会话？`, [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: onConfirm },
      ]);
    },
    [],
  );

  return {
    ...messageActions,
    handleMessageLongPress,
    handleRefreshWorktree,
    onNavigateRealPrompt,
    onWebMenuOpenChange,
    onWebMessageMenuAction,
    onMessageMenuSelect,
    messageMenuItems,
    confirmBatchDeleteSessions,
    closeMessageMenu: ctx.closeMessageMenu,
  };
}

export type ChatTabController = ReturnType<typeof useChatTabController>;
