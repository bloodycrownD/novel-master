/**
 * React Navigation param lists (prototype pageId → route names).
 */
import type {NavigatorScreenParams} from '@react-navigation/native';

export type MainTabParamList = {
  Chat: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  AgentsSettings: undefined;
  AgentEditor: {agentId?: string} | undefined;
  ProjectAgentConfig: {projectId: string};
  RealPrompt: undefined;
  Providers: undefined;
  ProviderCreate: undefined;
  ProviderEdit: {providerId?: string} | undefined;
  ProviderDetail: {providerId?: string} | undefined;
  ModelSampling: {savedModelId?: string} | undefined;

  StorageConfig: undefined;
  CloudSyncProgress: {
    op: 'pull' | 'push';
    forceOverwriteRemote?: boolean;
  };
  ChatConfig: undefined;
  CloudSyncConfig: undefined;
  GlobalTemplate: undefined;
  RegexGroups: undefined;
  RegexRules: {groupId?: string} | undefined;
  RegexRuleEditor: {groupId?: string; ruleId?: string} | undefined;
  FileEditor: {
    path: string;
    scopeKind: 'global' | 'project' | 'session';
    projectId?: string;
    sessionId?: string;
    /** Called after a successful session-scope save (refreshes workspace list). */
    onSessionVfsSaved?: () => void;
  };
  /** 会话详情页：承载原 SessionActionsDrawer 五项能力 + agent/model 来源展示。 */
  SessionDetail: { projectId: string; sessionId: string };
  /** 子代理会话只读浏览页：主会话点击 task 工具卡片跳转到此。文件在共享的父会话工作区，parentSessionId 用于 FileEditor 的 session scope。 */
  SubagentSessionView: { projectId: string; sessionId: string; parentSessionId: string };
  /** 聊天记录查询页：参数与 SessionDetail 一致，限定单会话范围搜索。 */
  ChatHistorySearch: { projectId: string; sessionId: string };
  About: undefined;
};

export type ChatHeaderContext = {
  chatSubview: 'sessions' | 'conversation';
  sessionListPanel: 'sessions' | 'template';
  /** 会话列表态顶栏标题：当前项目名称 */
  projectName?: string;
  sessionTitle?: string;
  onBackFromConversation?: () => void;
  onOpenDrawer?: () => void;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
