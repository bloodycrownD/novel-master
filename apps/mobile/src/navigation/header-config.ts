/**
 * Static titles and chrome flags per route (ported from prototype pageConfig).
 */
import type {RootStackParamList} from './types';

export type HeaderPageKey = keyof RootStackParamList | 'chat' | 'agents' | 'profile';

export interface PageHeaderConfig {
  title: string;
  showBack: boolean;
  showNav: boolean;
}

export const PAGE_HEADER_CONFIG: Record<HeaderPageKey, PageHeaderConfig> = {
  MainTabs: {title: '', showBack: false, showNav: true},
  chat: {title: '会话', showBack: false, showNav: true},
  agents: {title: 'Agent', showBack: false, showNav: true},
  profile: {title: '我的', showBack: false, showNav: true},
  AgentEditor: {title: 'Agent 配置', showBack: true, showNav: false},
  RealPrompt: {title: '真实提示词', showBack: true, showNav: false},
  SessionLog: {title: '会话日志', showBack: true, showNav: false},
  Providers: {title: '服务商管理', showBack: true, showNav: false},
  ProviderDetail: {title: '模型管理', showBack: true, showNav: false},
  ModelSampling: {title: '采样配置', showBack: true, showNav: false},
  CompactionPolicy: {title: '压缩策略', showBack: true, showNav: false},
  GlobalTemplate: {title: '全局模板', showBack: true, showNav: false},
  RegexGroups: {title: '正则配置', showBack: true, showNav: false},
  RegexRules: {title: '正则规则', showBack: true, showNav: false},
  RegexRuleEditor: {title: '规则详情', showBack: true, showNav: false},
  Settings: {title: '扩展设置', showBack: true, showNav: false},
  FileEditor: {title: '编辑文件', showBack: true, showNav: false},
  DevMenu: {title: '开发调试', showBack: true, showNav: false},
  VfsDev: {title: 'VFS 开发', showBack: true, showNav: false},
  SkspDev: {title: 'SKSP 开发', showBack: true, showNav: false},
};
