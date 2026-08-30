/**
 * Chat tab 顶栏导航 context（cr-fix-spec arch/C-1）：
 * 类型与 hook 定义在 navigation 层，由 screens 侧 ChatTabNavigationProvider
 * 写入值；AppHeader 等 chrome 组件只从本文件读，避免 components 反向依赖 screens。
 */
import React, {createContext, useContext} from 'react';

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
  /** 返回键关闭 mermaid 全屏查看器（下发 closeMermaidViewer）。 */
  readonly closeMermaidViewer: () => void;
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

export const ChatTabNavigationCtx =
  createContext<ChatTabNavigationContextValue | null>(null);

export function useChatTabNavigation(): ChatTabNavigationContextValue {
  const ctx = useContext(ChatTabNavigationCtx);
  if (ctx == null) {
    throw new Error(
      'useChatTabNavigation 须在 ChatTabNavigationProvider 内使用',
    );
  }
  return ctx;
}

export function useChatTabNavigationOptional(): ChatTabNavigationContextValue | null {
  return useContext(ChatTabNavigationCtx);
}
