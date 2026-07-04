/** SETTINGS_NAV / SETTINGS_VIEWS — aligned with examples/desktop/shell.js */

export type SettingsViewId =
  | "workspace"
  | "about"
  | "dataManagement"
  | "agentsSettings"
  | "agentEditor"
  | "providers"
  | "providerDetail"
  | "providerCreate"
  | "providerEdit"
  | "modelSampling"
  | "eventsConfig"
  | "regexGroups"
  | "regexRules"
  | "regexRuleEditor";

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
      { id: "eventsConfig" as const, label: "事件配置", icon: "⚡" },
      { id: "regexGroups" as const, label: "正则过滤", icon: "🛡️" },
    ],
  },
  {
    label: "数据",
    items: [{ id: "dataManagement" as const, label: "备份与恢复", icon: "💾" }],
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
  agentsSettings: "智能体配置",
  providers: "服务商配置",
  eventsConfig: "事件配置",
  regexGroups: "正则过滤",
};

export function getSettingsNavHighlightId(viewId: SettingsViewId): SettingsViewId {
  if (viewId === "agentEditor") return "agentsSettings";
  if (
    viewId === "providerDetail" ||
    viewId === "modelSampling" ||
    viewId === "providerCreate" ||
    viewId === "providerEdit"
  ) {
    return "providers";
  }
  if (viewId === "regexRules" || viewId === "regexRuleEditor") return "regexGroups";
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
}
