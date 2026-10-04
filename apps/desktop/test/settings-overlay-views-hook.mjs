/**
 * S-D-04 Overlay 壳层用例的 view 桩重定向钩子。
 *
 * SettingsOverlay 静态 import 了 9 个 view 模块，每个都牵 core 的一大片
 * （providers / prompts / skills / yaml …）。本用例只验 Overlay 壳层
 * （导航分发 / 守卫 / 关闭），把 view 全部打成 no-op，依赖树才起得来。
 * 形态对齐 workspace-settings-shell-nav-hook.mjs。
 */
const stubUrl = new URL("./settings-overlay-views-stub.ts", import.meta.url)
  .href;

const STUBBED = [
  "features/settings/SettingsViews",
  "features/settings/AboutView",
  "features/settings/TokenUsageStatsView",
  "features/settings/WorkspaceSettingsView",
  "features/settings/SkillsManageView",
  "features/settings/SkillDetailView",
  "features/settings/SearchEnginesView",
  "features/settings/SearchEngineDetailView",
];

export async function resolve(specifier, context, nextResolve) {
  if (STUBBED.some(name => specifier.includes(name))) {
    return {shortCircuit: true, url: stubUrl};
  }
  return nextResolve(specifier, context);
}
