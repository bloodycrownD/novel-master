/** SETTINGS_NAV / SETTINGS_VIEWS — aligned with examples/desktop/shell.js */

export type SettingsViewId =
  | "workspace"
  | "about"
  | "dataManagement"
  | "tokenUsageStats"
  | "agentsSettings"
  | "agentEditor"
  | "providers"
  | "providerDetail"
  | "providerCreate"
  | "modelSampling"
  | "regexGroups"
  | "regexRules"
  | "regexRuleEditor"
  | "skillsManage"
  | "skillDetail";

export const SETTINGS_NAV = [
  {
    label: "工作区",
    items: [{ id: "workspace" as const, label: "常规", icon: "🏠" }],
  },
  {
    label: "AI",
    items: [
      { id: "agentsSettings" as const, label: "智能体配置", icon: "🧠" },
      { id: "providers" as const, label: "服务商配置", icon: "🔌" },
    ],
  },
  {
    label: "高级",
    items: [
      { id: "regexGroups" as const, label: "正则过滤", icon: "🛡️" },
      { id: "skillsManage" as const, label: "技能管理", icon: "⚡" },
    ],
  },
  {
    label: "数据",
    items: [
      { id: "dataManagement" as const, label: "备份与恢复", icon: "💾" },
      { id: "tokenUsageStats" as const, label: "数据统计", icon: "📊" },
    ],
  },
  {
    label: "应用",
    items: [{ id: "about" as const, label: "关于", icon: "ℹ️" }],
  },
];

export const SETTINGS_TOP_LEVEL: Partial<Record<SettingsViewId, string>> = {
  workspace: "常规",
  about: "关于",
  dataManagement: "备份与恢复",
  tokenUsageStats: "数据统计",
  agentsSettings: "智能体配置",
  providers: "服务商配置",
  regexGroups: "正则过滤",
  skillsManage: "技能管理",
};

export function getSettingsNavHighlightId(viewId: SettingsViewId): SettingsViewId {
  if (viewId === "agentEditor") return "agentsSettings";
  if (
    viewId === "providerDetail" ||
    viewId === "modelSampling" ||
    viewId === "providerCreate"
  ) {
    return "providers";
  }
  if (viewId === "regexRules" || viewId === "regexRuleEditor") return "regexGroups";
  if (viewId === "skillDetail") return "skillsManage";
  return viewId;
}

export function isSettingsTopLevelView(viewId: SettingsViewId): boolean {
  return Object.prototype.hasOwnProperty.call(SETTINGS_TOP_LEVEL, viewId);
}

export interface SettingsNavHandle {
  push: (viewId: SettingsViewId) => void;
  pop: () => void;
  navState: SettingsNavState;
  /** Agent 编辑页顶栏标题（展示名称，非 agentId） */
  setAgentEditorTitle?: (title: string | undefined) => void;
}

export interface SettingsNavState {
  readonly editingAgentId?: string;
  /** Agent 编辑页顶栏展示用名称（非 agentId） */
  editingAgentDisplayName?: string;
  readonly editingProviderId?: string;
  readonly editingSavedModelId?: string;
  readonly editingRegexGroupId?: string;
  readonly editingRegexRuleId?: string;
  /** skillDetail 页定位的技能（域 + 项目 + 名称）。 */
  viewingSkillRef?: import("@shared/ipc-types").SkillRefDto;
}
