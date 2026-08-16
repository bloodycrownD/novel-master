import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getSettingsNavHighlightId,
  isSettingsTopLevelView,
  SETTINGS_NAV,
  SETTINGS_TOP_LEVEL,
  type SettingsNavHandle,
  type SettingsNavState,
  type SettingsViewId,
} from "../features/settings/settings-nav";
import {
  AgentEditorView,
  AgentsSettingsView,
  DataManagementView,
  ModelSamplingView,
  ProviderDetailView,
  ProviderFormView,
  ProvidersView,
  RegexGroupsView,
  RegexRuleEditorView,
  RegexRulesView,
} from "../features/settings/SettingsViews";
import { AboutView } from "../features/settings/AboutView";
import { WorkspaceSettingsView } from "../features/settings/WorkspaceSettingsView";
import { SkillsManageView } from "../features/settings/SkillsManageView";
import { SkillDetailView } from "../features/settings/SkillDetailView";
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
  if (viewId === "regexRules") return "正则规则";
  if (viewId === "regexRuleEditor") return navState.editingRegexRuleId ? "编辑规则" : "新规则";
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
      setAgentEditorTitle: setAgentEditorTitle,
    }),
    [pushView, popView],
  );

  const highlightId = getSettingsNavHighlightId(viewId);
  const showBack = !isSettingsTopLevelView(viewId);

  // 会话技能面板 / 工具卡片 → 设置栈跨组件跳转（App 监听同名事件打开设置页）。
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenSettingsViewDetail>).detail;
      if (detail == null) {
        return;
      }
      if (detail.view === "skillsManage") {
        navigateTopLevel("skillsManage");
        return;
      }
      navStateRef.current.viewingSkillRef = detail.skillRef;
      if (viewId !== "skillDetail") {
        pushView("skillDetail");
      }
    };
    window.addEventListener(OPEN_SETTINGS_VIEW_EVENT, handler);
    return () => window.removeEventListener(OPEN_SETTINGS_VIEW_EVENT, handler);
  }, [navigateTopLevel, pushView, viewId]);

  const renderContent = () => {
    switch (viewId) {
      case "workspace":
        return <WorkspaceSettingsView />;
      case "about":
        return <AboutView />;
      case "dataManagement":
        return <DataManagementView />;
      case "agentsSettings":
        return <AgentsSettingsView nav={nav} />;
      case "agentEditor":
        return <AgentEditorView nav={nav} />;

      case "providers":
        return <ProvidersView nav={nav} />;
      case "providerCreate":
        return <ProviderFormView nav={nav} mode="create" />;
      case "providerDetail":
        return <ProviderDetailView nav={nav} />;
      case "modelSampling":
        return <ModelSamplingView nav={nav} />;
      case "regexGroups":
        return <RegexGroupsView nav={nav} />;
      case "regexRules":
        return <RegexRulesView nav={nav} />;
      case "regexRuleEditor":
        return <RegexRuleEditorView nav={nav} />;
      case "skillsManage":
        return <SkillsManageView nav={nav} />;
      case "skillDetail":
        return <SkillDetailView nav={nav} />;
      default:
        return null;
    }
  };

  const handleClose = () => {
    setPageStack([]);
    setViewId("workspace");
    navStateRef.current = {};
    onClose();
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
                  onClick={() => navigateTopLevel(item.id)}
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
              onClick={popView}
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
    </div>
  );
}
