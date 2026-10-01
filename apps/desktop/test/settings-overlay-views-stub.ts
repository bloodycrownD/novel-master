/**
 * S-D-04 Overlay 壳层用例的 view 桩：所有设置页 view 都渲染一个带
 * data-view 标记的空 div（让用例能断言「当前挂的是哪个 view」），
 * 并把收到的 nav 句柄记到模块级 map 供测试读。
 *
 * 用 .ts（不是 .mjs）：这样它在 tsconfig.renderer.json 的检查面内、
 * 有真实类型，不会在测试文件里留下 TS7016 的隐式 any。
 */
import {createElement} from "react";
import type {SettingsNavHandle} from "@/features/settings/settings-nav";

/** viewId → 最近一次收到的 nav 句柄。 */
export const seenNavs = new Map<string, SettingsNavHandle>();

function makeStub(viewId: string) {
  return function StubView(props: {nav?: SettingsNavHandle}) {
    if (props?.nav != null) {
      seenNavs.set(viewId, props.nav);
    }
    return createElement("div", {"data-view": viewId});
  };
}

export const AgentEditorView = makeStub("agentEditor");
export const AgentsSettingsView = makeStub("agentsSettings");
export const DataManagementView = makeStub("dataManagement");
export const ModelSamplingView = makeStub("modelSampling");
export const ProviderDetailView = makeStub("providerDetail");
export const ProviderFormView = makeStub("providerCreate");
export const ProvidersView = makeStub("providers");
export const SmartSortRuleEditorView = makeStub("smartSortRuleEditor");
export const SmartSortRulesView = makeStub("smartSortRules");
export const AboutView = makeStub("about");
export const TokenUsageStatsView = makeStub("tokenUsageStats");
export const WorkspaceSettingsView = makeStub("workspace");
export const SkillsManageView = makeStub("skillsManage");
export const SkillDetailView = makeStub("skillDetail");
export const SearchEnginesView = makeStub("searchEngines");
export const SearchEngineDetailView = makeStub("searchEngineDetail");
