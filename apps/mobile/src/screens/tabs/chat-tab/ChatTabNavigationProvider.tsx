/**
 * Chat tab 顶栏导航态：供 AppHeader / Android 返回消费。
 * context、hook 与类型定义在 navigation/ChatTabNavContext（cr-fix-spec
 * arch/C-1），本组件只负责聚合并写入，避免 components 反向依赖 screens。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {useChatTabContext} from './ChatTabProvider';
import {ChatTabNavigationCtx} from '@/navigation/ChatTabNavContext';
import type {
  ChatTabNavigationActions,
  ChatTabNavigationState,
} from '@/navigation/ChatTabNavContext';

const WorkspaceBackCtx = createContext<React.Dispatch<
  React.SetStateAction<{
    canGoUp: boolean;
    goUp: () => void;
  } | null>
> | null>(null);

export type ChatTabNavigationProviderProps = {
  children: ReactNode;
  sessionBatchActive: boolean;
  onExitSessionBatch: () => void;
  /** 会话视图时三线按钮触发：跳转详情页（由父组件注入 navigation）。 */
  onOpenSessionDetail?: () => void;
};

export function ChatTabNavigationProvider({
  children,
  sessionBatchActive,
  onExitSessionBatch,
  onOpenSessionDetail,
}: ChatTabNavigationProviderProps) {
  const ctx = useChatTabContext();
  const [workspaceBackState, setWorkspaceBackState] = useState<{
    canGoUp: boolean;
    goUp: () => void;
  } | null>(null);

  const state = useMemo(
    (): ChatTabNavigationState => ({
      chatSubview: ctx.chatSubview === 'conversation' ? 'conversation' : 'list',
      sessionListPanel: ctx.scope.sessionListPanel,
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
      closeMermaidViewer: ctx.closeMermaidViewer,
      closeProjectDrawer: () => ctx.scope.setProjectDrawerOpen(false),
      showSessionsPanel: () => ctx.scope.setSessionListPanel('sessions'),
      openDrawer: () => {
        if (ctx.chatSubview === 'conversation') {
          // 三线按钮在会话视图：跳详情页（不再弹 SessionActionsDrawer）
          if (onOpenSessionDetail != null) {
            onOpenSessionDetail();
          } else {
            ctx.setSessionDrawerOpen(true);
          }
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
    [ctx, onExitSessionBatch, onOpenSessionDetail, workspaceBackState],
  );

  const value = useMemo(() => ({state, actions}), [state, actions]);

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
