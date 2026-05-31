/**
 * React Navigation param lists (prototype pageId → route names).
 */
import type {NavigatorScreenParams} from '@react-navigation/native';

export type MainTabParamList = {
  Chat: undefined;
  Agents: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  AgentEditor: {agentId?: string} | undefined;
  RealPrompt: undefined;
  SessionLog: undefined;
  Providers: undefined;
  ProviderDetail: {providerId?: string} | undefined;
  ModelSampling: {applicationModelId?: string} | undefined;
  CompactionPolicy: undefined;
  GlobalTemplate: undefined;
  RegexGroups: undefined;
  RegexRules: {groupId?: string} | undefined;
  RegexRuleEditor: {groupId?: string; ruleId?: string} | undefined;
  Settings: undefined;
  FileEditor: {
    path: string;
    scopeKind: 'global' | 'project' | 'session';
    projectId?: string;
    sessionId?: string;
  };
  DevMenu: undefined;
  VfsDev: undefined;
  SkspDev: undefined;
};

export type ChatHeaderContext = {
  chatSubview: 'sessions' | 'conversation';
  sessionListPanel: 'sessions' | 'template';
  sessionTitle?: string;
  onBackFromConversation?: () => void;
  onOpenDrawer?: () => void;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
