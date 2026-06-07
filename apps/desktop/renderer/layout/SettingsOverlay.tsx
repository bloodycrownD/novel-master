import { useCallback, useMemo, useRef, useState } from "react";
import {
  getSettingsNavHighlightId,
  isSettingsTopLevelView,
  SETTINGS_NAV,
  SETTINGS_TOP_LEVEL,
  type SettingsNavState,
  type SettingsViewId,
} from "../features/settings/settings-nav";
import {
  AgentEditorView,
  AgentsSettingsView,
  CompactionConditionsView,
  DataManagementView,
  EventsConfigView,
  ModelSamplingView,
  ProviderDetailView,
  ProviderFormView,
  ProvidersView,
  RegexGroupsView,
  RegexRuleEditorView,
  RegexRulesView,
} from "../features/settings/SettingsViews";
import { WorkspaceSettingsView } from "../features/settings/WorkspaceSettingsView";

interface SettingsOverlayProps {
  open: boolean;
  onClose: () => void;
}

function getSettingsMainTitle(viewId: SettingsViewId, navState: SettingsNavState): string {
  if (viewId === "agentEditor") {
    return navState.editingAgentId ? `Agent · ${navState.editingAgentId}` : "Agent 配置";
  }
  if (viewId === "providerDetail") return "模型管理";
  if (viewId === "providerCreate") return "新建服务商";
  if (viewId === "providerEdit") return "编辑服务商";
  if (viewId === "modelSampling") return "采样配置";
  if (viewId === "regexRules") return "正则规则";
  if (viewId === "regexRuleEditor") return navState.editingRegexRuleId ? "编辑规则" : "新规则";
  return SETTINGS_TOP_LEVEL[viewId] ?? "设置";
}

export function SettingsOverlay({ open, onClose }: SettingsOverlayProps) {
  const [viewId, setViewId] = useState<SettingsViewId>("workspace");
  const [pageStack, setPageStack] = useState<SettingsViewId[]>([]);
  const navStateRef = useRef<SettingsNavState>({});

  const navState = navStateRef.current;

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

  const nav = useMemo(
    () => ({
      push: pushView,
      pop: popView,
      navState: navStateRef.current,
    }),
    [pushView, popView],
  );

  const highlightId = getSettingsNavHighlightId(viewId);
  const showBack = !isSettingsTopLevelView(viewId);

  const renderContent = () => {
    switch (viewId) {
      case "workspace":
        return <WorkspaceSettingsView />;
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
      case "providerEdit":
        return <ProviderFormView nav={nav} mode="edit" />;
      case "providerDetail":
        return <ProviderDetailView nav={nav} />;
      case "modelSampling":
        return <ModelSamplingView nav={nav} />;
      case "compactionConditions":
        return <CompactionConditionsView />;
      case "eventsConfig":
        return <EventsConfigView />;
      case "regexGroups":
        return <RegexGroupsView nav={nav} />;
      case "regexRules":
        return <RegexRulesView nav={nav} />;
      case "regexRuleEditor":
        return <RegexRuleEditorView nav={nav} />;
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
              {getSettingsMainTitle(viewId, navState)}
            </h2>
            <button type="button" className="settings-main__close" onClick={handleClose} aria-label="关闭设置">
              ×
            </button>
          </header>
          <div className="settings-page__content" id="settings-page-root">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
