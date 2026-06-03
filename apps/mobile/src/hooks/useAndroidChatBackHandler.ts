/**
 * Android hardware back for Chat Tab only (registered while the tab is focused).
 * Aligns system back / edge swipe with segmented sub-panels:
 * conversation workspace → chat → session list; template → sessions; then exit app.
 */
import {useCallback} from 'react';
import {BackHandler, Platform} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';

export type AndroidChatBackState = {
  chatSubview: 'sessions' | 'conversation';
  conversationPanel: 'chat' | 'workspace';
  sessionListPanel: 'sessions' | 'template';
  sessionDrawerOpen: boolean;
  messageMenuOpen: boolean;
  messageBatchActive: boolean;
  messageEditOpen: boolean;
  modelPickerOpen: boolean;
  agentPickerOpen: boolean;
  sessionRenameOpen: boolean;
  projectDrawerOpen: boolean;
  sessionBatchActive: boolean;
};

export type AndroidChatBackActions = {
  backFromConversation: () => void;
  showChatPanel: () => void;
  closeSessionDrawer: () => void;
  closeMessageMenu: () => void;
  exitMessageBatch: () => void;
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
    messageMenuOpen,
    messageBatchActive,
    messageEditOpen,
    modelPickerOpen,
    agentPickerOpen,
    sessionRenameOpen,
    projectDrawerOpen,
    sessionBatchActive,
  } = state;

  const {
    backFromConversation,
    showChatPanel,
    closeSessionDrawer,
    closeMessageMenu,
    exitMessageBatch,
    closeMessageEdit,
    closeModelPicker,
    closeAgentPicker,
    closeSessionRename,
    closeProjectDrawer,
    exitSessionBatch,
    showSessionsPanel,
  } = actions;

  const handler = useCallback((): boolean => {
    // Conversation overlays: dismiss before leaving the message surface.
    if (sessionDrawerOpen) {
      closeSessionDrawer();
      return true;
    }
    if (messageMenuOpen) {
      closeMessageMenu();
      return true;
    }
    if (messageBatchActive) {
      exitMessageBatch();
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
      showSessionsPanel();
      return true;
    }

    return false;
  }, [
    sessionDrawerOpen,
    messageMenuOpen,
    messageBatchActive,
    messageEditOpen,
    modelPickerOpen,
    agentPickerOpen,
    sessionRenameOpen,
    chatSubview,
    conversationPanel,
    projectDrawerOpen,
    sessionBatchActive,
    sessionListPanel,
    backFromConversation,
    showChatPanel,
    closeSessionDrawer,
    closeMessageMenu,
    exitMessageBatch,
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
