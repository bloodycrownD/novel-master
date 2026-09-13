/** SETTINGS_NAV / SETTINGS_VIEWS — aligned with examples/desktop/shell.js */

export type SettingsViewId =
  | "workspace"
  | "about"
  | "dataManagement"
  | "tokenUsageStats"
  | "agentsSettings"
  | "searchEngines"
  | "searchEngineDetail"
  | "agentEditor"
  | "providers"
  | "providerDetail"
  | "providerCreate"
  | "modelSampling"
  | "smartSortRules"
  | "smartSortRuleEditor"
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
      { id: "searchEngines" as const, label: "搜索配置", icon: "🔍" },
      { id: "providers" as const, label: "服务商配置", icon: "🔌" },
    ],
  },
  {
    label: "高级",
    items: [
      { id: "smartSortRules" as const, label: "智能排序", icon: "🔢" },
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
  searchEngines: "搜索配置",
  providers: "服务商配置",
  smartSortRules: "智能排序",
  skillsManage: "技能管理",
};

export function getSettingsNavHighlightId(viewId: SettingsViewId): SettingsViewId {
  if (viewId === "agentEditor") return "agentsSettings";
  if (viewId === "searchEngineDetail") return "searchEngines";
  if (
    viewId === "providerDetail" ||
    viewId === "modelSampling" ||
    viewId === "providerCreate"
  ) {
    return "providers";
  }
  if (viewId === "smartSortRuleEditor") return "smartSortRules";
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
  /**
   * 各 view 的未保存编辑标记（通用 dirty 上报通道，key=viewId；同一时刻一个
   * viewId 仅一个实例挂载）。有意挂在 handle 而非 navState 上：navState 会被
   * handleClose 整体重建（`navStateRef.current = {}`），而本集合由 Overlay 的
   * useRef 持有、引用永不重建——dirty 写侧（`nav.dirtyViews`）与守卫读侧始终
   * 是同一 Set，不受 navState 换对象影响。
   *
   * 上报约定：挂载首跑即写入当前 dirty 值（清异常残留、自愈）；dirty 变化持续
   * 同步；卸载时清掉自己的标记（确认导航切走后不留死 view）。
   */
  dirtyViews: Set<SettingsViewId>;
  /** Agent 编辑页顶栏标题（展示名称，非 agentId） */
  setAgentEditorTitle?: (title: string | undefined) => void;
}

export interface SettingsNavState {
  readonly editingAgentId?: string;
  /** Agent 编辑页顶栏展示用名称（非 agentId） */
  editingAgentDisplayName?: string;
  readonly editingProviderId?: string;
  /** 搜索引擎详情页定位的引擎（EngineId 字符串）。 */
  editingEngineId?: string;
  readonly editingSavedModelId?: string;
  /** smartSortRuleEditor 页定位的规则（undefined = 新建）。 */
  readonly editingSmartSortRuleId?: string;
  /** skillDetail 页定位的技能（域 + 项目 + 名称）。 */
  viewingSkillRef?: import("@shared/ipc-types").SkillRefDto;
}

/** skillRef 三元组（domain/projectId/name）等价判定；双方均缺省视为等价。 */
export function isSameSkillRef(
  a: import("@shared/ipc-types").SkillRefDto | undefined,
  b: import("@shared/ipc-types").SkillRefDto | undefined,
): boolean {
  if (a == null && b == null) {
    return true;
  }
  if (a == null || b == null) {
    return false;
  }
  return (
    a.domain === b.domain && a.projectId === b.projectId && a.name === b.name
  );
}

export interface SettingsNavGuardInput {
  /** 当前挂载的 view */
  readonly currentViewId: SettingsViewId;
  /** dirty 上报集合（nav.dirtyViews） */
  readonly dirtyViews: ReadonlySet<SettingsViewId>;
  /** 动作完成后的 viewId（关闭固定回 workspace；返回为退栈目标；编程式技能跳转固定 skillDetail） */
  readonly nextViewId: SettingsViewId;
  /** 动作将覆写 viewingSkillRef 时的新值（编程式技能跳转；不覆写则缺省） */
  readonly incomingSkillRef?: import("@shared/ipc-types").SkillRefDto;
  /** 当前 viewingSkillRef（同三元组重入放行判定用） */
  readonly viewingSkillRef?: import("@shared/ipc-types").SkillRefDto;
}

/**
 * 设置导航守卫纯判定（拦截返回 true，需先弹「未保存的更改」确认）：
 *
 * 1. 卸载型：动作会把当前 view 切走（nextViewId ≠ currentViewId）且该 view
 *    上报了 dirty——`<div key={viewId}>` 使 viewId 变化即同步卸载，卸载后才弹
 *    确认为时已晚，故拦截必须在导航分发之前。
 * 2. ref 覆写型（第四分发点不卸载的失效模式）：当前就在 skillDetail 且动作
 *    将覆写 viewingSkillRef——三元组不同则组件内 reload 会直接覆盖编辑
 *    state，dirty 编辑静默丢失，须拦截；三元组相同不触发 reload、无数据丢失，
 *    直接放行（弹窗属误报）。
 */
export function shouldGuardSettingsNav(input: SettingsNavGuardInput): boolean {
  if (
    input.nextViewId !== input.currentViewId &&
    input.dirtyViews.has(input.currentViewId)
  ) {
    return true;
  }
  if (
    input.incomingSkillRef != null &&
    input.currentViewId === "skillDetail" &&
    input.nextViewId === "skillDetail" &&
    input.dirtyViews.has(input.currentViewId) &&
    !isSameSkillRef(input.viewingSkillRef, input.incomingSkillRef)
  ) {
    return true;
  }
  return false;
}
