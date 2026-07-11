/**
 * Chat tab 顶栏导航态：供 AppHeader / Android 返回消费。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useChatTabContext } from './ChatTabProvider';

export type ChatTabNavigationState = {
  readonly chatSubview: 'list' | 'conversation';
  readonly sessionListPanel: 'sessions' | 'projects';
  readonly projectName: string | undefined;
  readonly sessionTitle: string | undefined;
  readonly sessionDrawerOpen: boolean;
  readonly projectDrawerOpen: boolean;
  readonly sessionBatchActive: boolean;
  readonly workspaceCanGoUp: boolean;
};

export type ChatTabNavigationActions = {
  readonly backFromConversation: () => void;
  readonly showChatPanel: () => void;
  readonly closeSessionDrawer: () => void;
  readonly closeProjectDrawer: () => void;
  readonly showSessionsPanel: () => void;
  readonly openDrawer: () => void;
  readonly closeMessageMenu: () => void;
  readonly closeMessageEdit: () => void;
  readonly closeModelPicker: () => void;
  readonly closeAgentPicker: () => void;
  readonly closeSessionRename: () => void;
  readonly exitSessionBatch: () => void;
  readonly workspaceGoUp: (() => void) | undefined;
};

export type ChatTabNavigationContextValue = {
  readonly state: ChatTabNavigationState;
  readonly actions: ChatTabNavigationActions;
};

const ChatTabNavigationCtx = createContext<ChatTabNavigationContextValue | null>(
  null,
);

const WorkspaceBackCtx = createContext<
  React.Dispatch<
    React.SetStateAction<{
      canGoUp: boolean;
      goUp: () => void;
    } | null>
  > | null
>(null);

export function useChatTabNavigation(): ChatTabNavigationContextValue {
  const ctx = useContext(ChatTabNavigationCtx);
  if (ctx == null) {
    throw new Error('useChatTabNavigation 须在 ChatTabNavigationProvider 内使用');
  }
  return ctx;
}

export function useChatTabNavigationOptional(): ChatTabNavigationContextValue | null {
  return useContext(ChatTabNavigationCtx);
}

export type ChatTabNavigationProviderProps = {
  children: ReactNode;
  sessionBatchActive: boolean;
  onExitSessionBatch: () => void;
};

export function ChatTabNavigationProvider({
  children,
  sessionBatchActive,
  onExitSessionBatch,
}: ChatTabNavigationProviderProps) {
  const ctx = useChatTabContext();
  const [workspaceBackState, setWorkspaceBackState] = useState<{
    canGoUp: boolean;
    goUp: () => void;
  } | null>(null);

  const state = useMemo(
    (): ChatTabNavigationState => ({
      chatSubview:
        ctx.chatSubview === 'conversation' ? 'conversation' : 'list',
      sessionListPanel:
        ctx.scope.sessionListPanel === 'template'
          ? 'projects'
          : 'sessions',
      projectName: ctx.scope.currentProject?.name,
      sessionTitle:
        ctx.scope.currentSession?.title ?? ctx.scope.currentSession?.id,
      sessionDrawerOpen: ctx.sessionDrawerOpen,
      projectDrawerOpen: ctx.scope.projectDrawerOpen,
      sessionBatchActive,
      workspaceCanGoUp: workspaceBackState?.canGoUp ?? false,
    }),
    [
      ctx.chatSubview,
      ctx.scope.sessionListPanel,
      ctx.scope.currentProject,
      ctx.scope.currentSession,
      ctx.sessionDrawerOpen,
      ctx.scope.projectDrawerOpen,
      sessionBatchActive,
      workspaceBackState,
    ],
  );

  const actions = useMemo(
    (): ChatTabNavigationActions => ({
      backFromConversation: ctx.scope.backFromConversation,
      showChatPanel: () => ctx.setConversationPanel('chat'),
      closeSessionDrawer: () => ctx.setSessionDrawerOpen(false),
      closeProjectDrawer: () => ctx.scope.setProjectDrawerOpen(false),
      showSessionsPanel: () => ctx.scope.setSessionListPanel('sessions'),
      openDrawer: () => {
        if (ctx.chatSubview === 'conversation') {
          ctx.setSessionDrawerOpen(true);
        } else {
          ctx.scope.setProjectDrawerOpen(true);
        }
      },
      closeMessageMenu: ctx.closeMessageMenu,
      closeMessageEdit: () => ctx.setMessageEditPrompt(undefined),
      closeModelPicker: () => ctx.setModelPickerOpen(false),
      closeAgentPicker: () => ctx.setAgentPickerOpen(false),
      closeSessionRename: () => ctx.scope.setSessionRenamePrompt(undefined),
      exitSessionBatch: onExitSessionBatch,
      workspaceGoUp: workspaceBackState?.goUp,
    }),
    [ctx, onExitSessionBatch, workspaceBackState],
  );

  const value = useMemo(
    () => ({ state, actions }),
    [state, actions],
  );

  return (
    <WorkspaceBackCtx.Provider value={setWorkspaceBackState}>
      <ChatTabNavigationCtx.Provider value={value}>
        {children}
      </ChatTabNavigationCtx.Provider>
    </WorkspaceBackCtx.Provider>
  );
}

export function useChatTabWorkspaceBackState() {
  return useContext(WorkspaceBackCtx);
}
