/**
 * Chat tab: session list / template sub-tabs, conversation workspace.
 */
import React, {useCallback, useLayoutEffect} from 'react';
import {StyleSheet, View} from 'react-native';
import {
  useNavigation,
  type CompositeNavigationProp,
} from '@react-navigation/native';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {AppHeader} from '@/components/chrome/AppHeader';
import {ProjectDrawer} from '@/components/chrome/ProjectDrawer';
import {TextPromptModal} from '@/components/ui/TextPromptModal';
import {useAndroidChatBackHandler} from '@/hooks/useAndroidChatBackHandler';
import {useBatchSelection} from '@/hooks/useBatchSelection';
import {useMobileScope} from '@/hooks/useMobileScope';
import {useTheme} from '@/theme/ThemeProvider';
import {resolveChatTabBarStyle} from '@/navigation/main-tab-bar-style';
import type {MainTabParamList, RootStackParamList} from '@/navigation/types';
import {setPromptEditorOnSaved} from '@/components/agent/prompt-editor-callback';
import {writeChatComposerDraft} from '@/storage/chat-composer-draft';
import {ChatConversationPanel} from './chat-tab/ChatConversationPanel';
import {ChatSessionListPanel} from './chat-tab/ChatSessionListPanel';
import {ChatTabProvider, useChatTabContext} from './chat-tab/ChatTabProvider';
import {ChatTabNavigationProvider} from './chat-tab/ChatTabNavigationProvider';
import {useChatTabNavigation} from '@/navigation/ChatTabNavContext';
import {useChatTabController} from './chat-tab/useChatTabController';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Chat'>,
  NativeStackNavigationProp<RootStackParamList>
>;

function ChatTabScreenInner() {
  const sessionBatch = useBatchSelection();
  const ctx = useChatTabContext();
  const navigation = useNavigation<Nav>();

  const onOpenSessionDetail = useCallback(() => {
    if (ctx.projectId != null && ctx.sessionId != null) {
      navigation.navigate('SessionDetail', {
        projectId: ctx.projectId,
        sessionId: ctx.sessionId,
      });
    }
  }, [ctx.projectId, ctx.sessionId, navigation]);

  return (
    <ChatTabNavigationProvider
      sessionBatchActive={sessionBatch.active}
      onExitSessionBatch={sessionBatch.exit}
      onOpenSessionDetail={onOpenSessionDetail}
    >
      <ChatTabScreenContent sessionBatch={sessionBatch} />
    </ChatTabNavigationProvider>
  );
}

function ChatTabScreenContent({
  sessionBatch,
}: {
  sessionBatch: ReturnType<typeof useBatchSelection>;
}) {
  const {tokens} = useTheme();
  const insets = useSafeAreaInsets();
  const ctx = useChatTabContext();
  const controller = useChatTabController();
  const nav = useChatTabNavigation();
  const {setCurrentProject, setCurrentSession} = useMobileScope();
  const navigation = useNavigation<Nav>();

  useLayoutEffect(() => {
    navigation.setOptions({
      tabBarStyle: resolveChatTabBarStyle(ctx.chatSubview, tokens, insets),
    });
    // navigation 在 RN 中引用稳定；勿列入 deps，避免测试 mock 每次新建对象导致死循环
  }, [
    ctx.chatSubview,
    insets.bottom,
    tokens.borderLight,
    tokens.tabBarBackground,
  ]);

  useAndroidChatBackHandler(
    {
      chatSubview: ctx.chatSubview,
      conversationPanel: ctx.conversationPanel,
      sessionListPanel: ctx.scope.sessionListPanel,
      sessionDrawerOpen: ctx.sessionDrawerOpen,
      mermaidViewerOpen: ctx.mermaidViewerOpen,
      messageMenuOpen: ctx.messageMenuTarget != null || ctx.webMenuOpen,
      messageEditOpen: ctx.messageEditPrompt != null,
      modelPickerOpen: ctx.modelPickerOpen,
      agentPickerOpen: ctx.agentPickerOpen,
      sessionRenameOpen: ctx.scope.sessionRenamePrompt != null,
      projectDrawerOpen: ctx.scope.projectDrawerOpen,
      sessionBatchActive: nav.state.sessionBatchActive,
      workspaceCanGoUp: nav.state.workspaceCanGoUp,
      workspaceGoUp: nav.actions.workspaceGoUp,
    },
    {
      backFromConversation: nav.actions.backFromConversation,
      showChatPanel: nav.actions.showChatPanel,
      closeSessionDrawer: nav.actions.closeSessionDrawer,
      closeMermaidViewer: nav.actions.closeMermaidViewer,
      closeMessageMenu: nav.actions.closeMessageMenu,
      closeMessageEdit: nav.actions.closeMessageEdit,
      closeModelPicker: nav.actions.closeModelPicker,
      closeAgentPicker: nav.actions.closeAgentPicker,
      closeSessionRename: nav.actions.closeSessionRename,
      closeProjectDrawer: nav.actions.closeProjectDrawer,
      exitSessionBatch: nav.actions.exitSessionBatch,
      showSessionsPanel: nav.actions.showSessionsPanel,
    },
  );

  const openConversation = useCallback(
    async (sid: string) => {
      if (ctx.projectId == null) {
        return;
      }
      await setCurrentSession(sid);
      // 会话切换防闪：view cache 命中即同步采纳进 manager 的 idle 消息面
      // （Step 7 收口：原 hook 的 hydrateFromSessionCache 等价迁移）。
      ctx.runtime.sessionStreamUnitManager.hydrateSessionMessages(
        ctx.projectId,
        sid,
      );
      ctx.setChatSubview('conversation');
      ctx.setConversationPanel('chat');
    },
    [ctx, setCurrentSession],
  );

  const confirmBatchDelete = useCallback(() => {
    controller.confirmBatchDeleteSessions(sessionBatch.selectedCount, () =>
      // 删除错误已在 deleteSelectedSessions 内部处理并 toast，
      // 这里只兜底避免意外的 Promise 拒绝变成未处理告警。
      ctx.scope
        .deleteSelectedSessions(sessionBatch.selectedIds, sessionBatch.exit)
        .catch(() => undefined),
    );
  }, [controller, sessionBatch, ctx.scope]);

  // ⛶ 全屏编辑（照 onOpenSessionDetail 先例：chat-tab 目录零导航依赖，惯例是
  // 父层注入回调）：跳的就是智能体配置那套全屏编辑页（PromptEditor 的 composer
  // 变体——同一组件同一条键盘链，纯编辑态：预览/档位切换与保存按钮都不渲染，
  // 编辑器退出即回填，没有显式保存动作）。初始文本走路由参数；退出回填写进
  // 模块级存取（回调不可序列化，不走路由参数）。
  // 本回调自身对 scope 缺 projectId/sessionId 时静默 return，面板侧另按
  // scopeReady 决定要不要注入（见 ChatConversationPanel 的 scopeReady 注释），
  // 让 ⛶ 走既有 disabled 通路而不是变成点了没反应的死按钮。
  const setDraftRestoreToken = ctx.messages.setDraftRestoreToken;
  const runtime = ctx.runtime;
  const onOpenComposerFullscreen = useCallback(
    (payload: {text: string}) => {
      const targetSessionId = ctx.sessionId;
      if (ctx.projectId == null || targetSessionId == null) {
        return;
      }
      // composer 变体没有保存按钮：编辑器卸载（返回/手势）即回填——写入会话草稿
      // （内联输入 onChangeText 落的是同一条 store），再 bump 草稿恢复令牌触发
      // ChatComposer 从草稿重读（undo_send 同款回填链路）。
      setPromptEditorOnSaved(text => {
        writeChatComposerDraft(targetSessionId, text, runtime.sessions);
        setDraftRestoreToken(token => token + 1);
      });
      navigation.navigate('PromptEditor', {
        title: '编辑消息',
        initialText: payload.text,
        variant: 'composer',
        // @/$ tag 的 typeahead 与选择器需要 scope（技能合并视图 / 会话工作区）
        projectId: ctx.projectId,
        sessionId: targetSessionId,
      });
    },
    [ctx.projectId, ctx.sessionId, runtime, setDraftRestoreToken, navigation],
  );

  const sessionRenameModal = (
    <TextPromptModal
      visible={ctx.scope.sessionRenamePrompt != null}
      title="重命名会话"
      label="会话名称"
      placeholder="输入会话名称"
      initialValue={ctx.scope.sessionRenamePrompt?.initialTitle ?? ''}
      confirmLabel="保存"
      onClose={() => ctx.scope.setSessionRenamePrompt(undefined)}
      onConfirm={async values => {
        const prompt = ctx.scope.sessionRenamePrompt;
        ctx.scope.setSessionRenamePrompt(undefined);
        if (prompt) {
          await ctx.scope.handleRenameSession(prompt.sessionId, values[0]);
        }
      }}
    />
  );

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <AppHeader pageKey="chat" />
      {ctx.chatSubview === 'conversation' ? (
        <ChatConversationPanel
          tokens={tokens}
          visible
          onOpenComposerFullscreen={onOpenComposerFullscreen}
        />
      ) : null}
      <ChatSessionListPanel
        tokens={tokens}
        visible={ctx.chatSubview === 'sessions'}
        sessionListPanel={ctx.scope.sessionListPanel}
        onSessionListPanelChange={ctx.scope.setSessionListPanel}
        projectId={ctx.projectId}
        sessionId={ctx.sessionId}
        sessions={ctx.scope.sessions}
        vfsRefreshKey={ctx.vfsRefreshKey}
        projectVfs={ctx.scope.projectVfs}
        projectWorktree={ctx.scope.projectWorktree}
        sessionBatchActive={sessionBatch.active}
        sessionBatchSelectedCount={sessionBatch.selectedCount}
        onEnterSessionBatch={sessionBatch.enter}
        onExitSessionBatch={sessionBatch.exit}
        onConfirmBatchDelete={confirmBatchDelete}
        onCreateSession={() =>
          ctx.scope.handleCreateSession().catch(() => undefined)
        }
        onOpenConversation={sid => openConversation(sid).catch(() => undefined)}
        onToggleSessionSelect={sessionBatch.toggle}
        isSessionSelected={sessionBatch.isSelected}
        menuSessionId={ctx.scope.menuSessionId}
        onMenuSessionIdChange={ctx.scope.setMenuSessionId}
        onOpenSessionRename={ctx.scope.openSessionRenamePrompt}
        onCopySession={sid =>
          ctx.scope.handleCopySession(sid).catch(() => undefined)
        }
        onConfirmDeleteSession={ctx.scope.confirmDeleteSession}
        onOpenFileEditor={ctx.onOpenFileEditor}
      />
      {sessionRenameModal}
      <ProjectDrawer
        visible={ctx.scope.projectDrawerOpen}
        projects={ctx.scope.projects}
        currentProjectId={ctx.projectId}
        onClose={() => ctx.scope.setProjectDrawerOpen(false)}
        onSelect={async id => {
          await setCurrentProject(id);
          await ctx.scope.reloadLists();
        }}
        onCreateProject={ctx.scope.handleCreateProject}
        onRenameProject={ctx.scope.handleRenameProject}
        onDeleteSelected={ctx.scope.handleDeleteProjects}
      />
    </View>
  );
}

export function ChatTabScreen() {
  return (
    <ChatTabProvider>
      <ChatTabScreenInner />
    </ChatTabProvider>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
