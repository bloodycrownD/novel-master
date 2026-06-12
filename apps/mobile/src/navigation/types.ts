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
  RealPrompt: undefined;
  Providers: undefined;
  ProviderCreate: undefined;
  ProviderEdit: {providerId?: string} | undefined;
  ProviderDetail: {providerId?: string} | undefined;
  ModelSampling: {applicationModelId?: string} | undefined;
  CompactionConditions: undefined;
  EventsConfig: undefined;
  StorageConfig: undefined;
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
  About: undefined;
};

export type ChatHeaderContext = {
  chatSubview: 'sessions' | 'conversation';
  sessionListPanel: 'sessions' | 'template';
  sessionTitle?: string;
  agentName?: string;
  modelLabel?: string;
  onBackFromConversation?: () => void;
  onOpenDrawer?: () => void;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
