/**
 * React Navigation param lists (prototype pageId → route names).
 */
import type {NavigatorScreenParams} from '@react-navigation/native';
import type {EngineId} from '@novel-master/core';

export type MainTabParamList = {
  Chat: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  AgentsSettings: undefined;
  AgentEditor: {agentId?: string} | undefined;
  /**
   * 真实提示词预览屏。scope 走路由参数（可选 + 屏内回落全局 scope）：
   * 只读 `useMobileScope()` 会在「后台通知栈外改 scope」时展示**别的会话**的提示词，
   * 而页面上没有任何会话名提示、用户无从察觉（AM-3）。
   */
  RealPrompt: {projectId?: string; sessionId?: string} | undefined;
  /**
   * 提示词单轮详情页（纯预览态，只读）。轮正文可达数百 KB，**不走路由参数**，
   * 由 prompt-turn-callback 模块级存取传递；params 只带可序列化的短标题与轮 id
   * （标题用于 header 覆盖，轮 id 拼详情页 `FileMarkdownPreview` 的稳定伪 path）。
   */
  PromptTurnDetail: {title?: string; turnId?: string} | undefined;
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
  /** 云端存储设置：同步状态卡、云存储配置入口与拉取/推送操作。 */
  CloudSyncStorage: undefined;
  /** 搜索配置：引擎列表（排序即串行链优先级，无参数）。 */
  SearchEngines: undefined;
  /** 搜索引擎详情：单引擎表单（key / baseUrl），标题用引擎名。 */
  SearchEngineDetail: {engineId: EngineId} | undefined;
  GlobalTemplate: undefined;
  /** 智能排序规则列表（spec smart-filename-sort Step 13）。 */
  SmartSortRules: undefined;
  SmartSortRuleEditor: {ruleId?: string} | undefined;
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
    // 「session 域保存成功后刷新工作区列表」的回调**不走路由参数**
    // （不可序列化），由 file-editor-saved-callback 模块级存取。同一份文件里
    // PromptEditor 的注释即是这条范式的出处。
  };
  /** 会话技能面板：当前项目合并视图 + 启停开关（写项目负清单）。 */
  SkillPanel: {projectId: string};
  /** 全屏编辑页：智能体配置的提示词字段与 chat 输入框全屏共用同一套编辑屏。
   *  variant 决定保存语义——`form` 草稿副本编辑、保存才回填（缺省）；
   *  `composer` 无保存概念、退出即回填（那块文本就是输入框内容本身）。
   *  composer 变体带 projectId/sessionId 时启用 @/$ tag 的 typeahead 与选择器
   *  （缺省静默降级——tag 胶囊高亮仍生效）。回调不走路由参数（不可序列化），
   *  由 prompt-editor-callback 模块级存取。 */
  PromptEditor: {
    title?: string;
    initialText: string;
    variant?: 'form' | 'composer';
    projectId?: string;
    sessionId?: string;
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
