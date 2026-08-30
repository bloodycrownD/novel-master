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
    /** physical = 全局文件浏览器的只读物理路径（保存禁用，仅预览）。 */
    scopeKind: 'global' | 'project' | 'session' | 'skill' | 'physical';
    projectId?: string;
    sessionId?: string;
    /** skill 域引用：按域取 globalMetaVfs/projectMetaVfs，路由 path 为 /meta/skills/{name}/{rel}。 */
    skillRef?: {
      domain: 'global' | 'project';
      name: string;
      projectId?: string;
    };
    /** Called after a successful session-scope save (refreshes workspace list). */
    onSessionVfsSaved?: () => void;
  };
  /** 会话技能面板：当前项目合并视图 + 启停开关（写项目负清单）。 */
  SkillPanel: {projectId: string};
  /** 全屏提示词编辑页：草稿副本编辑，保存才回填，取消/返回键不动原值。
   *  回调不走路由参数（不可序列化），由 prompt-editor-callback 模块级存取。 */
  PromptEditor: {
    title?: string;
    initialText: string;
  };
  /** 设置·技能管理页：全局默认 / 项目分组双 tab。 */
  SkillsSettings: undefined;
  /** 技能详情页：文件浏览 + 新建/删除辅助文件。 */
  SkillDetail: {
    domain: 'global' | 'project';
    name: string;
    projectId?: string;
  };
  /** 会话详情页：承载原 SessionActionsDrawer 五项能力 + agent/model 来源展示。 */
  SessionDetail: {projectId: string; sessionId: string};
  /** 子代理会话只读浏览页：主会话点击 task 工具卡片跳转到此。文件在共享的父会话工作区，parentSessionId 用于 FileEditor 的 session scope。 */
  SubagentSessionView: {
    projectId: string;
    sessionId: string;
    parentSessionId: string;
  };
  /** 聊天记录查询页：参数与 SessionDetail 一致，限定单会话范围搜索。 */
  ChatHistorySearch: {projectId: string; sessionId: string};
  /** 数据统计页：Token 用量与缓存命中率（无参数，筛选在页内进行）。 */
  TokenUsageStats: undefined;
  About: undefined;
};

export type ChatHeaderContext = {
  chatSubview: 'sessions' | 'conversation';
  sessionListPanel: 'sessions' | 'projects';
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
