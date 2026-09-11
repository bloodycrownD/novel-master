/**
 * Chat tab 低频回调：消息菜单、工作区导航等。
 *
 * Step 6 接线微调（spec 点名表）：原 ctx.uiRunning（源自被删的运行态装配）
 * 换为单元投影派生（status 为 starting|running）；resetStreamingDisplay
 * （原 useSessionStream 的 state 清空）换为 manager 的 reset-stream 控制消息
 * 广播（webview 侧 resetStream，单元 partial 由 core step 边界清零）。
 */
import {useCallback} from 'react';
import {Alert} from 'react-native';
import {buildMessageActionItems} from '@/components/chat/message-edit';
import {clearSessionWorkplaceKkv} from '@/services/workplace-block.service';
import {useChatTabContext} from './ChatTabProvider';
import {useChatTabMessageActions} from './useChatTabMessageActions';

export function useChatTabController() {
  const ctx = useChatTabContext();

  // 当前会话 run 是否活跃（单元投影派生；水合未完成/无单元为静止态）。
  const sessionRunActive =
    ctx.unitView?.status === 'starting' || ctx.unitView?.status === 'running';

  // 流式显示清理的单元等效：请求单元向全句柄广播 reset-stream（legacy
  // MessageList 的 partial props 随投影清空由消费方自理——rollback/fork 后
  // 消息面以落库行为准）。
  const resetStreamingDisplay = useCallback(() => {
    if (ctx.sessionId != null) {
      ctx.runtime.sessionStreamUnitManager.requestStreamReset(ctx.sessionId);
    }
  }, [ctx.sessionId, ctx.runtime]);

  const messageActions = useChatTabMessageActions({
    runtime: ctx.runtime,
    projectId: ctx.projectId,
    sessionId: ctx.sessionId,
    messages: ctx.messages,
    agentRunning: sessionRunActive,
    resetStreamingDisplay,
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
      if (sessionRunActive) {
        return;
      }
      ctx.setMessageMenuTarget(msg);
      ctx.setMessageMenuAnchor(anchor);
    },
    [ctx, sessionRunActive],
  );

  const handleCapturePromptFileBlock = useCallback(() => {
    if (ctx.projectId == null || ctx.sessionId == null) {
      return;
    }
    void (async () => {
      try {
        await clearSessionWorkplaceKkv(ctx.runtime, {
          projectId: ctx.projectId!,
          sessionId: ctx.sessionId!,
        });
        ctx.showToast('已重置常驻工作区缓存');
      } catch {
        ctx.showToast('重置常驻工作区缓存失败');
      }
    })();
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
        {text: '取消', style: 'cancel'},
        {text: '删除', style: 'destructive', onPress: onConfirm},
      ]);
    },
    [],
  );

  return {
    ...messageActions,
    handleMessageLongPress,
    handleCapturePromptFileBlock,
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
