/**
 * Static titles and chrome flags per route (ported from prototype pageConfig).
 */
import {coreT} from '@/i18n/core';
import type {RootStackParamList} from './types';

export type HeaderPageKey = keyof RootStackParamList | 'chat' | 'profile';

interface PageHeaderConfig {
  title: string;
  showBack: boolean;
  showNav: boolean;
}

export const PAGE_HEADER_CONFIG: Record<HeaderPageKey, PageHeaderConfig> = {
  MainTabs: {title: '', showBack: false, showNav: true},
  chat: {title: coreT({key: "ui.nav.chat"}), showBack: false, showNav: true},
  profile: {title: coreT({key: "ui.nav.tab_profile"}), showBack: false, showNav: true},
  AgentsSettings: {title: coreT({key: "ui.nav.agent_settings"}), showBack: true, showNav: false},
  AgentEditor: {title: coreT({key: "ui.nav.agent_settings"}), showBack: true, showNav: false},
  RealPrompt: {title: coreT({key: "ui.nav.view_prompt"}), showBack: true, showNav: false},
  PromptTurnDetail: {title: coreT({key: "ui.nav.turn_detail"}), showBack: true, showNav: false},
  Providers: {title: coreT({key: "ui.nav.providers"}), showBack: true, showNav: false},
  ProviderCreate: {title: coreT({key: "ui.nav.provider_create"}), showBack: true, showNav: false},
  ProviderDetail: {title: coreT({key: "ui.nav.model_management"}), showBack: true, showNav: false},
  ModelSampling: {title: coreT({key: "ui.nav.sampling"}), showBack: true, showNav: false},

  StorageConfig: {title: coreT({key: "ui.nav.storage"}), showBack: true, showNav: false},
  CloudSyncProgress: {title: coreT({key: "ui.nav.cloud_sync"}), showBack: true, showNav: false},
  ChatConfig: {title: '聊天配置', showBack: true, showNav: false},
  CloudSyncConfig: {title: coreT({key: "ui.nav.cloud_storage"}), showBack: true, showNav: false},
  CloudSyncStorage: {title: coreT({key: "ui.nav.cloud_storage_setup"}), showBack: true, showNav: false},
  SearchEngines: {title: coreT({key: "ui.nav.search_engines"}), showBack: true, showNav: false},
  SearchEngineDetail: {title: coreT({key: "ui.nav.search_engines"}), showBack: true, showNav: false},
  GlobalTemplate: {title: coreT({key: "ui.nav.file_browser"}), showBack: true, showNav: false},
  SmartSortRules: {title: coreT({key: "ui.nav.smart_sort_rules"}), showBack: true, showNav: false},
  SmartSortRuleEditor: {title: coreT({key: "ui.nav.rule_editor"}), showBack: true, showNav: false},
  FileEditor: {title: coreT({key: "ui.nav.file_editor"}), showBack: true, showNav: false},
  SessionDetail: {title: coreT({key: "ui.nav.session_detail"}), showBack: true, showNav: false},
  SkillPanel: {title: coreT({key: "ui.nav.skills"}), showBack: true, showNav: false},
  PromptEditor: {title: coreT({key: "ui.nav.prompt_editor"}), showBack: true, showNav: false},
  SkillsSettings: {title: coreT({key: "ui.nav.skills_manage"}), showBack: true, showNav: false},
  SkillDetail: {title: coreT({key: "ui.nav.skill_detail"}), showBack: true, showNav: false},
  SubagentSessionView: {title: coreT({key: "ui.nav.subagent_session"}), showBack: true, showNav: false},
  TokenUsageStats: {title: coreT({key: "ui.nav.token_stats"}), showBack: true, showNav: false},
  About: {title: coreT({key: "ui.nav.about"}), showBack: true, showNav: false},
};
