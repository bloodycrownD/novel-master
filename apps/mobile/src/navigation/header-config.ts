/**
 * Static titles and chrome flags per route (ported from prototype pageConfig).
 */
import type {RootStackParamList} from './types';

export type HeaderPageKey = keyof RootStackParamList | 'chat' | 'profile';

export interface PageHeaderConfig {
  title: string;
  showBack: boolean;
  showNav: boolean;
}

export const PAGE_HEADER_CONFIG: Record<HeaderPageKey, PageHeaderConfig> = {
  MainTabs: {title: '', showBack: false, showNav: true},
  chat: {title: '会话', showBack: false, showNav: true},
  profile: {title: '我的', showBack: false, showNav: true},
  AgentsSettings: {title: '智能体配置', showBack: true, showNav: false},
  AgentEditor: {title: 'Agent 配置', showBack: true, showNav: false},
  RealPrompt: {title: '查看提示词', showBack: true, showNav: false},
  Providers: {title: '服务商配置', showBack: true, showNav: false},
  ProviderCreate: {title: '添加服务商', showBack: true, showNav: false},
  ProviderEdit: {title: '编辑服务商', showBack: true, showNav: false},
  ProviderDetail: {title: '模型管理', showBack: true, showNav: false},
  ModelSampling: {title: '采样配置', showBack: true, showNav: false},
  CompactionConditions: {title: '压缩配置', showBack: true, showNav: false},
  EventsConfig: {title: '事件配置', showBack: true, showNav: false},
  StorageConfig: {title: '存储配置', showBack: true, showNav: false},
  CloudSyncProgress: {title: '云同步', showBack: true, showNav: false},
  ChatConfig: {title: '聊天配置', showBack: true, showNav: false},
  CloudSyncConfig: {title: '云存储配置', showBack: true, showNav: false},
  GlobalTemplate: {title: '全局工作区', showBack: true, showNav: false},
  RegexGroups: {title: '正则配置', showBack: true, showNav: false},
  RegexRules: {title: '正则规则', showBack: true, showNav: false},
  RegexRuleEditor: {title: '规则详情', showBack: true, showNav: false},
  FileEditor: {title: '编辑文件', showBack: true, showNav: false},
  About: {title: '关于 Novel Master', showBack: true, showNav: false},
};
