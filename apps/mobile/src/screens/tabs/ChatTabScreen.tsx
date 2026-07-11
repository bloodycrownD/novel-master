/**
 * Chat tab: session list / template sub-tabs, conversation workspace.
 */
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppHeader } from '@/components/chrome/AppHeader';
import { ProjectDrawer } from '@/components/chrome/ProjectDrawer';
import { TextPromptModal } from '@/components/ui/TextPromptModal';
import { useAndroidChatBackHandler } from '@/hooks/useAndroidChatBackHandler';
import { useBatchSelection } from '@/hooks/useBatchSelection';
import { useMobileScope } from '@/hooks/useMobileScope';
import { useTheme } from '@/theme/ThemeProvider';
import type { RootStackParamList } from '@/navigation/types';
import { ChatConversationPanel } from './chat-tab/ChatConversationPanel';
import { ChatSessionListPanel } from './chat-tab/ChatSessionListPanel';
import { ChatTabProvider, useChatTabContext } from './chat-tab/ChatTabProvider';
import {
  ChatTabNavigationProvider,
  useChatTabNavigation,
} from './chat-tab/ChatTabNavigationProvider';
import { useChatTabController } from './chat-tab/useChatTabController';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function ChatTabScreenInner() {
  const sessionBatch = useBatchSelection();

  return (
    <ChatTabNavigationProvider
      sessionBatchActive={sessionBatch.active}
      onExitSessionBatch={sessionBatch.exit}
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
  const { tokens } = useTheme();
  const ctx = useChatTabContext();
  const controller = useChatTabController();
  const nav = useChatTabNavigation();
  const { setCurrentProject, setCurrentSession } = useMobileScope();
  const navigation = useNavigation<Nav>();

  useAndroidChatBackHandler(
    {
      chatSubview: ctx.chatSubview,
      conversationPanel: ctx.conversationPanel,
      sessionListPanel: ctx.scope.sessionListPanel,
      sessionDrawerOpen: ctx.sessionDrawerOpen,
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
      ctx.messages.hydrateFromSessionCache(ctx.projectId, sid);
      ctx.setChatSubview('conversation');
      ctx.setConversationPanel('chat');
    },
    [ctx, setCurrentSession],
  );

  const confirmBatchDelete = useCallback(() => {
    controller.confirmBatchDeleteSessions(sessionBatch.selectedCount, () =>
      ctx.scope
        .deleteSelectedSessions(sessionBatch.selectedIds, sessionBatch.exit)
        .catch(() => undefined),
    );
  }, [controller, sessionBatch, ctx.scope]);

  const sessionRenameModal = (
    <TextPromptModal
      visible={ctx.scope.sessionRenamePrompt != null}
      title="重命名会话"
      label="会话名称"
      placeholder="输入会话名称"
      initialValue={ctx.scope.sessionRenamePrompt?.initialTitle ?? ''}
      confirmLabel="保存"
      onClose={() => ctx.scope.setSessionRenamePrompt(undefined)}
      onConfirm={async value => {
        const prompt = ctx.scope.sessionRenamePrompt;
        ctx.scope.setSessionRenamePrompt(undefined);
        if (prompt) {
          await ctx.scope.handleRenameSession(prompt.sessionId, value);
        }
      }}
    />
  );

  return (
    <View style={[styles.root, { backgroundColor: tokens.background }]}>
      <AppHeader pageKey="chat" />
      {ctx.chatSubview === 'conversation' ? (
        <ChatConversationPanel tokens={tokens} visible />
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
        bumpWorktreeUiToken={ctx.bumpWorktreeUiToken}
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
        onOpenAgentConfig={id => {
          ctx.scope.setProjectDrawerOpen(false);
          navigation.navigate('ProjectAgentConfig', { projectId: id });
        }}
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
  root: { flex: 1 },
});
