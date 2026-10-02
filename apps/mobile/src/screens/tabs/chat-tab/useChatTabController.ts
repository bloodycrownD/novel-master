/**
 * Chat tab 低频回调：消息菜单、工作区导航等。
 *
 * Step 6 接线微调（spec 点名表）：原 ctx.uiRunning（源自被删的运行态装配）
 * 换为单元投影派生（status 为 starting|running）；resetStreamingDisplay
 * （原 useSessionStream 的 state 清空）换为 manager 的 reset-stream 控制消息
 * 广播（webview 侧 resetStream，单元 partial 由 core step 边界清零）。
 *
 * Step 8（legacy 转录引擎退役）：消息菜单只剩 web 一条路径——`onWebMenuOpenChange`
 * / `onWebMessageMenuAction`（webview 内菜单 → RN 处置）。原先的
 * `handleMessageLongPress`（RN 长按 → `MessageActionMenu`）与
 * `onMessageMenuSelect` / `messageMenuItems`（驱动那张 RN 弹层）随
 * `MessageActionMenu.tsx` 一并删除；RN 侧不再有任何消息菜单浮层。
 */
import {useCallback, useRef} from 'react';
import {Alert} from 'react-native';
import {clearSessionWorkplaceKkv} from '@/services/workplace-block.service';
import {createSnapshotCompleteSignal} from '@/services/snapshot-complete-signal';
import {useChatTabContext} from './ChatTabProvider';
import {useChatTabMessageActions} from './useChatTabMessageActions';

export function useChatTabController() {
  const ctx = useChatTabContext();

  // 快照完成信号盒（rollback-large-jank Step 5）：webview 组件侧 notify
  // （末片 post + deferred 排空后），回滚链 consumeNext 错峰 token 重算。
  // useRef 持有——跨回滚轮次复用，每次 consumeNext 重置等待态。
  const snapshotSignalRef = useRef(createSnapshotCompleteSignal());
  const notifySnapshotComplete = useCallback(() => {
    snapshotSignalRef.current.notify();
  }, []);
  const snapshotCompleteSignal = snapshotSignalRef.current;

  // 当前会话 run 是否活跃（单元投影派生；水合未完成/无单元为静止态）。
  const sessionRunActive =
    ctx.unitView?.status === 'starting' || ctx.unitView?.status === 'running';

  // 流式显示清理的单元等效：请求单元向全句柄广播 reset-stream（消息面
  // partial 随投影清空——rollback/fork 后消息面以落库行为准）。
  const resetStreamingDisplay = useCallback(() => {
    if (ctx.sessionId != null) {
      ctx.runtime.sessionStreamUnitManager.requestStreamReset(ctx.sessionId);
    }
  }, [ctx.sessionId, ctx.runtime]);

  // 消息操作后的 force 回源刷新（Step 7 收口：直连 manager，消息面单一
  // 来源；force 语义与原 hook 的 reloadMessages(true) 等价）。
  const reloadMessages = useCallback(
    (force = true) =>
      ctx.sessionId == null
        ? Promise.resolve(null)
        : ctx.runtime.sessionStreamUnitManager.loadSessionTailMessages(
            ctx.sessionId,
            {force, projectId: ctx.projectId},
          ),
    [ctx.sessionId, ctx.projectId, ctx.runtime],
  );

  const messageActions = useChatTabMessageActions({
    runtime: ctx.runtime,
    projectId: ctx.projectId,
    sessionId: ctx.sessionId,
    chatMessages: ctx.chatMessages,
    reloadMessages,
    setDraftRestoreToken: ctx.messages.setDraftRestoreToken,
    agentRunning: sessionRunActive,
    resetStreamingDisplay,
    showToast: ctx.showToast,
    refreshChatTokenLabel: ctx.scope.refreshChatTokenLabel,
    snapshotCompleteSignal,
    bumpWorktreeUiToken: ctx.bumpWorktreeUiToken,
    reloadLists: ctx.scope.reloadLists,
    setCurrentSession: ctx.setCurrentSession,
    setChatSubview: ctx.setChatSubview,
    setConversationPanel: ctx.setConversationPanel,
    setMessageEditPrompt: ctx.setMessageEditPrompt,
  });

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
    // AM-3：scope 走路由参数。两值皆空时等价于无参调用（屏内回落全局 scope），
    // 不引入新分支。
    ctx.navigation.navigate('RealPrompt', {
      projectId: ctx.projectId ?? undefined,
      sessionId: ctx.sessionId ?? undefined,
    });
  }, [ctx]);

  const onWebMenuOpenChange = useCallback(
    (open: boolean) => {
      ctx.setWebMenuOpen(open);
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
    handleCapturePromptFileBlock,
    onNavigateRealPrompt,
    onWebMenuOpenChange,
    onWebMessageMenuAction,
    confirmBatchDeleteSessions,
    closeMessageMenu: ctx.closeMessageMenu,
    notifySnapshotComplete,
  };
}

export type ChatTabController = ReturnType<typeof useChatTabController>;
