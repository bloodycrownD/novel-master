import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SkillRefDto } from "@shared/ipc-types";
import {
  getSettingsNavHighlightId,
  isSettingsTopLevelView,
  SETTINGS_NAV,
  SETTINGS_TOP_LEVEL,
  shouldGuardSettingsNav,
  type SettingsNavHandle,
  type SettingsNavState,
  type SettingsViewId,
} from "../features/settings/settings-nav";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import {
  AgentEditorView,
  AgentsSettingsView,
  DataManagementView,
  ModelSamplingView,
  ProviderDetailView,
  ProviderFormView,
  ProvidersView,
  SmartSortRuleEditorView,
  SmartSortRulesView,
} from "../features/settings/SettingsViews";
import { AboutView } from "../features/settings/AboutView";
import { TokenUsageStatsView } from "../features/settings/TokenUsageStatsView";
import { WorkspaceSettingsView } from "../features/settings/WorkspaceSettingsView";
import { SkillsManageView } from "../features/settings/SkillsManageView";
import { SkillDetailView } from "../features/settings/SkillDetailView";
import { SearchEnginesView } from "../features/settings/SearchEnginesView";
import { SearchEngineDetailView } from "../features/settings/SearchEngineDetailView";
import { engineLabel } from "../features/settings/search-engine-meta";
import {
  OPEN_SETTINGS_VIEW_EVENT,
  type OpenSettingsViewDetail,
} from "../features/skills/skill-ui";

interface SettingsOverlayProps {
  open: boolean;
  onClose: () => void;
}

function getSettingsMainTitle(
  viewId: SettingsViewId,
  navState: SettingsNavState,
  agentEditorTitle?: string,
): string {
  if (viewId === "agentEditor") {
    return agentEditorTitle ?? navState.editingAgentDisplayName ?? "智能体配置";
  }
  if (viewId === "providerDetail") return "模型管理";
  if (viewId === "providerCreate") return "新建服务商";
  if (viewId === "modelSampling") return "采样配置";
  if (viewId === "smartSortRuleEditor") {
    return navState.editingSmartSortRuleId ? "编辑规则" : "新规则";
  }
  if (viewId === "searchEngineDetail") {
    const label = engineLabel(navState.editingEngineId);
    return label ? `搜索引擎 · ${label}` : "搜索引擎";
  }
  if (viewId === "skillDetail") {
    return navState.viewingSkillRef != null
      ? `技能 · ${navState.viewingSkillRef.name}`
      : "技能详情";
  }
  return SETTINGS_TOP_LEVEL[viewId] ?? "设置";
}

export function SettingsOverlay({ open, onClose }: SettingsOverlayProps) {
  const [viewId, setViewId] = useState<SettingsViewId>("workspace");
  const [pageStack, setPageStack] = useState<SettingsViewId[]>([]);
  const [agentEditorTitle, setAgentEditorTitle] = useState<string | undefined>();
  const navStateRef = useRef<SettingsNavState>({});
  // dirty 上报通道（见 SettingsNavHandle.dirtyViews）：独立于 navState 的稳定
  // Set 引用、永不重建——handleClose 里 `navStateRef.current = {}` 换对象时，
  // dirty 写侧（nav.dirtyViews）与守卫读侧仍是同一 Set，不会分叉（换对象陷阱
  // 规避：dirty 读写统一走同一引用）。
  const dirtyViewsRef = useRef<Set<SettingsViewId>>(new Set());
  // 守卫挂起的 pending 导航：确认后落地、取消作废（navState 不动）。
  const [pendingNav, setPendingNav] = useState<null | (() => void)>(null);

  const navState = navStateRef.current;

  useEffect(() => {
    if (viewId !== "agentEditor") {
      setAgentEditorTitle(undefined);
    }
  }, [viewId]);

  const showView = useCallback((next: SettingsViewId) => {
    setViewId(next);
  }, []);

  const pushView = useCallback((next: SettingsViewId) => {
    setPageStack((stack) => [...stack, viewId]);
    setViewId(next);
  }, [viewId]);

  const popView = useCallback(() => {
    setPageStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1]!;
      setViewId(prev);
      return stack.slice(0, -1);
    });
  }, []);

  const navigateTopLevel = useCallback((next: SettingsViewId) => {
    setPageStack([]);
    setViewId(next);
  }, []);

  const nav = useMemo<SettingsNavHandle>(
    () => ({
      push: pushView,
      pop: popView,
      navState: navStateRef.current,
      dirtyViews: dirtyViewsRef.current,
      setAgentEditorTitle: setAgentEditorTitle,
    }),
    // dirtyViews 为 useRef 持有的稳定引用，不随 navState 重建分叉；
    // navState 快照沿用既有 deps（pushView 随 viewId 变化自然刷新）。
    [pushView, popView],
  );

  /**
   * 统一导航守卫入口（四个 Overlay 层分发点共用）：动作会卸载上报 dirty 的
   * 当前 view、或把 skillDetail 的 ref 入参覆写为不同技能时，先弹「未保存的
   * 更改」确认——pending 挂起、确认后落地、取消则 navState 不动。
   *
   * 注意 nav.push / nav.pop（handle 裸入口）不过此守卫：view 内部已有自带确认
   * 逻辑的调用（如 SkillDetailView 的 guarded → leaveConfirm），双重拦截会
   * 连弹两次。守卫只覆盖 Overlay 层的 UI 分发点（侧导航 / 返回 / 关闭 / 事件）。
   */
  const guardedNav = useCallback(
    (
      guard: { nextViewId: SettingsViewId; incomingSkillRef?: SkillRefDto },
      action: () => void,
    ) => {
      if (
        shouldGuardSettingsNav({
          currentViewId: viewId,
          dirtyViews: dirtyViewsRef.current,
          nextViewId: guard.nextViewId,
          incomingSkillRef: guard.incomingSkillRef,
          viewingSkillRef: navStateRef.current.viewingSkillRef,
        })
      ) {
        setPendingNav(() => action);
        return;
      }
      action();
    },
    [viewId],
  );

  const highlightId = getSettingsNavHighlightId(viewId);
  const showBack = !isSettingsTopLevelView(viewId);

  // 会话技能面板 / 工具卡片 → 设置栈跨组件跳转（App 监听同名事件打开设置页）。
  // hidden 态可见性契约：守卫挂起（pending）期间设置页必须可见——App 侧监听
  // 同一事件、detail 非空即 setSettingsOpen(true)，与本 handler 同事件同步
  // 执行、同批渲染，弹窗出现即 overlay 已打开；此处不得存在 hidden 时静默
  // 放行/挂起分支（pending 若跨 hidden 期存活，重开设置页时弹窗可见继续确认）。
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenSettingsViewDetail>).detail;
      if (detail == null) {
        return;
      }
      if (detail.view === "skillsManage") {
        // 「整理」跳转：整页切换会卸载当前 view，过守卫
        guardedNav({ nextViewId: "skillsManage" }, () =>
          navigateTopLevel("skillsManage"),
        );
        return;
      }
      // 技能详情跳转：viewingSkillRef 覆写与条件入栈全部包进 pending 动作、
      // 确认后才落地（覆写若先行会绕过守卫，dirty 编辑静默丢失）；取消则
      // navState 不动。同 skillRef 三元组重入由守卫纯函数放行（无 reload、
      // 无数据丢失，不弹窗）。
      guardedNav(
        { nextViewId: "skillDetail", incomingSkillRef: detail.skillRef },
        () => {
          navStateRef.current.viewingSkillRef = detail.skillRef;
          if (viewId !== "skillDetail") {
            pushView("skillDetail");
          }
        },
      );
    };
    window.addEventListener(OPEN_SETTINGS_VIEW_EVENT, handler);
    return () => window.removeEventListener(OPEN_SETTINGS_VIEW_EVENT, handler);
  }, [guardedNav, navigateTopLevel, pushView, viewId]);

  const renderContent = () => {
    switch (viewId) {
      case "workspace":
        return <WorkspaceSettingsView />;
      case "about":
        return <AboutView />;
      case "dataManagement":
        return <DataManagementView />;
      case "tokenUsageStats":
        return <TokenUsageStatsView />;
      case "agentsSettings":
        return <AgentsSettingsView nav={nav} />;
      case "agentEditor":
        return <AgentEditorView nav={nav} />;
      case "searchEngines":
        return <SearchEnginesView nav={nav} />;
      case "searchEngineDetail":
        return <SearchEngineDetailView nav={nav} />;

      case "providers":
        return <ProvidersView nav={nav} />;
      case "providerCreate":
        return <ProviderFormView nav={nav} mode="create" />;
      case "providerDetail":
        return <ProviderDetailView nav={nav} />;
      case "modelSampling":
        return <ModelSamplingView nav={nav} />;
      case "smartSortRules":
        return <SmartSortRulesView nav={nav} />;
      case "smartSortRuleEditor":
        return <SmartSortRuleEditorView nav={nav} />;
      case "skillsManage":
        return <SkillsManageView nav={nav} />;
      case "skillDetail":
        return <SkillDetailView nav={nav} />;
      default:
        return null;
    }
  };

  const handleClose = () => {
    // 关闭会重置回 workspace：dirty 的子页（如 skillDetail）被卸载，须过守卫；
    // 停在 workspace 时 nextViewId 相同、无卸载，纯函数放行直接关。
    guardedNav({ nextViewId: "workspace" }, () => {
      setPageStack([]);
      setViewId("workspace");
      // 换对象重建 navState：dirty 通道不走 navState（dirtyViews 独立引用），
      // 换对象不会使守卫读写分叉。
      navStateRef.current = {};
      onClose();
    });
  };

  return (
    <div
      id="settings-page"
      className={`settings-page${open ? "" : " hidden"}`}
      hidden={!open}
      aria-hidden={!open}
    >
      <div className="settings-page__body">
        <nav className="settings-nav" id="settings-nav" aria-label="设置分类">
          <div className="settings-nav__brand">设置</div>
          {SETTINGS_NAV.map((section) => (
            <div key={section.label} className="settings-nav__section">
              <div className="settings-nav__heading">{section.label}</div>
              {section.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav__item${item.id === highlightId ? " is-active" : ""}`}
                  data-settings-nav={item.id}
                  onClick={() =>
                    guardedNav({ nextViewId: item.id }, () =>
                      navigateTopLevel(item.id),
                    )
                  }
                >
                  <span className="settings-nav__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-main">
          <header className="settings-main__header" id="settings-main-header">
            <button
              type="button"
              className={`settings-main__back${showBack ? "" : " hidden"}`}
              id="settings-main-back"
              data-action="settings-back"
              aria-label="返回上一级"
              onClick={() => {
                // 退栈目标为栈顶；顶层页无退栈（按钮隐藏态兜底）直接放行。
                // 注：nav.pop（view 内部「返回」按钮）不走守卫，调用方自带确认。
                const prev = pageStack[pageStack.length - 1];
                if (prev == null) {
                  popView();
                  return;
                }
                guardedNav({ nextViewId: prev }, popView);
              }}
            >
              ‹
            </button>
            <h2 className="settings-main__title" id="settings-main-title">
              {getSettingsMainTitle(viewId, navState, agentEditorTitle)}
            </h2>
            <button type="button" className="settings-main__close" onClick={handleClose} aria-label="关闭设置">
              ×
            </button>
          </header>
          <div className="settings-page__content" id="settings-page-root">
            <div key={viewId} className="settings-view">
              {renderContent()}
            </div>
          </div>
        </div>
      </div>
      {/* 导航守卫确认弹窗（pending 落地/取消）：渲染在 settings-page 内随 overlay
          可见性同步；文案与 SkillDetailView 内部「未保存的更改」同款。 */}
      <ConfirmModal
        open={pendingNav != null}
        title="未保存的更改"
        message="有未保存的更改，离开将丢弃。是否继续？"
        danger
        onConfirm={() => {
          const action = pendingNav;
          setPendingNav(null);
          action?.();
        }}
        onCancel={() => setPendingNav(null)}
      />
    </div>
  );
}
