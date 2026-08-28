/**
 * Android hardware back for Chat Tab only (registered while the tab is focused).
 * Aligns system back / edge swipe with segmented sub-panels:
 * conversation workspace → chat → session list; template workspace dirs →
 * template → sessions; then exit app.
 */
import { useCallback } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

export type AndroidChatBackState = {
  chatSubview: 'sessions' | 'conversation';
  conversationPanel: 'chat' | 'workspace';
  sessionListPanel: 'sessions' | 'template';
  sessionDrawerOpen: boolean;
  /** mermaid 全屏查看器开着（WebView 上浮）；返回键先关全屏。可选：未接线时无拦截。 */
  mermaidViewerOpen?: boolean;
  messageMenuOpen: boolean;
  messageEditOpen: boolean;
  modelPickerOpen: boolean;
  agentPickerOpen: boolean;
  sessionRenameOpen: boolean;
  projectDrawerOpen: boolean;
  sessionBatchActive: boolean;
  /** 工作区是否可返回上级目录（根目录时为 false）。 */
  workspaceCanGoUp?: boolean;
  /** 工作区返回上级目录。 */
  workspaceGoUp?: () => void;
};

export type AndroidChatBackActions = {
  backFromConversation: () => void;
  showChatPanel: () => void;
  closeSessionDrawer: () => void;
  /** 返回键关闭 mermaid 全屏查看器（下发 closeMermaidViewer）。 */
  closeMermaidViewer?: () => void;
  closeMessageMenu: () => void;
  closeMessageEdit: () => void;
  closeModelPicker: () => void;
  closeAgentPicker: () => void;
  closeSessionRename: () => void;
  closeProjectDrawer: () => void;
  exitSessionBatch: () => void;
  showSessionsPanel: () => void;
};

/** Registers hardwareBackPress while Chat Tab is focused; no-op on iOS. */
export function useAndroidChatBackHandler(
  state: AndroidChatBackState,
  actions: AndroidChatBackActions,
): void {
  const {
    chatSubview,
    conversationPanel,
    sessionListPanel,
    sessionDrawerOpen,
    mermaidViewerOpen,
    messageMenuOpen,
    messageEditOpen,
    modelPickerOpen,
    agentPickerOpen,
    sessionRenameOpen,
    projectDrawerOpen,
    sessionBatchActive,
    workspaceCanGoUp,
    workspaceGoUp,
  } = state;

  const {
    backFromConversation,
    showChatPanel,
    closeSessionDrawer,
    closeMermaidViewer,
    closeMessageMenu,
    closeMessageEdit,
    closeModelPicker,
    closeAgentPicker,
    closeSessionRename,
    closeProjectDrawer,
    exitSessionBatch,
    showSessionsPanel,
  } = actions;

  const handler = useCallback((): boolean => {
    // Mermaid 全屏查看器盖在一切会话 surface 之上：返回键最先关全屏。
    if (mermaidViewerOpen) {
      closeMermaidViewer?.();
      return true;
    }
    // Conversation overlays: dismiss before leaving the message surface.
    if (sessionDrawerOpen) {
      closeSessionDrawer();
      return true;
    }
    if (messageMenuOpen) {
      closeMessageMenu();
      return true;
    }
    if (messageEditOpen) {
      closeMessageEdit();
      return true;
    }
    if (modelPickerOpen) {
      closeModelPicker();
      return true;
    }
    if (agentPickerOpen) {
      closeAgentPicker();
      return true;
    }
    if (sessionRenameOpen) {
      closeSessionRename();
      return true;
    }

    if (chatSubview === 'conversation') {
      if (conversationPanel === 'workspace') {
        if (workspaceCanGoUp && workspaceGoUp) {
          workspaceGoUp();
          return true;
        }
        showChatPanel();
        return true;
      }
      backFromConversation();
      return true;
    }

    // Session list overlays and sub-tabs before exiting the app.
    if (projectDrawerOpen) {
      closeProjectDrawer();
      return true;
    }
    if (sessionBatchActive) {
      exitSessionBatch();
      return true;
    }
    if (sessionListPanel === 'template') {
      // 项目工作区同聊天工作区：先逐级退目录，根目录才切回会话列表
      if (workspaceCanGoUp && workspaceGoUp) {
        workspaceGoUp();
        return true;
      }
      showSessionsPanel();
      return true;
    }

    return false;
  }, [
    mermaidViewerOpen,
    sessionDrawerOpen,
    messageMenuOpen,
    messageEditOpen,
    modelPickerOpen,
    agentPickerOpen,
    sessionRenameOpen,
    chatSubview,
    conversationPanel,
    projectDrawerOpen,
    sessionBatchActive,
    sessionListPanel,
    workspaceCanGoUp,
    workspaceGoUp,
    backFromConversation,
    showChatPanel,
    closeSessionDrawer,
    closeMermaidViewer,
    closeMessageMenu,
    closeMessageEdit,
    closeModelPicker,
    closeAgentPicker,
    closeSessionRename,
    closeProjectDrawer,
    exitSessionBatch,
    showSessionsPanel,
  ]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', handler);
      return () => sub.remove();
    }, [handler]),
  );
}
