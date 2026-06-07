/** SETTINGS_NAV / SETTINGS_VIEWS — aligned with examples/desktop/shell.js */

export type SettingsViewId =
  | "workspace"
  | "dataManagement"
  | "agentsSettings"
  | "agentEditor"
  | "providers"
  | "providerDetail"
  | "providerCreate"
  | "providerEdit"
  | "modelSampling"
  | "compactionConditions"
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
      { id: "agentsSettings" as const, label: "Agent", icon: "🧠" },
      { id: "providers" as const, label: "服务商与模型", icon: "🔌" },
    ],
  },
  {
    label: "高级",
    items: [
      { id: "compactionConditions" as const, label: "压缩条件", icon: "🗜️" },
      { id: "eventsConfig" as const, label: "事件配置", icon: "⚡" },
      { id: "regexGroups" as const, label: "正则过滤", icon: "🛡️" },
    ],
  },
  {
    label: "数据",
    items: [{ id: "dataManagement" as const, label: "备份与恢复", icon: "💾" }],
  },
];

export const SETTINGS_TOP_LEVEL: Partial<Record<SettingsViewId, string>> = {
  workspace: "常规",
  dataManagement: "备份与恢复",
  agentsSettings: "Agent",
  providers: "服务商与模型",
  compactionConditions: "压缩条件",
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

export interface SettingsNavState {
  readonly editingAgentId?: string;
  readonly editingProviderId?: string;
  readonly editingVendorModelId?: string;
  readonly editingApplicationModelId?: string;
  readonly editingRegexGroupId?: string;
  readonly editingRegexRuleId?: string;
}
