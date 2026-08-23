import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsViewsPath = path.join(
  __dirname,
  "..",
  "renderer",
  "features",
  "settings",
  "SettingsViews.tsx",
);
const source = readFileSync(settingsViewsPath, "utf8");

/**
 * T-T1 / T-T4：desktop 服务商 tab 化 + 移除「编辑」菜单项。
 * 用源码断言（与 settings-agents-delete-confirm.test.ts 一致的惯例）：
 * desktop renderer 组件交互在 node:test 下不易模拟，行为靠类型 + 手工覆盖。
 */
test("T-T1: ProviderDetailView 改 tab 容器，含两个 tab 选项（服务商配置 + 模型管理）", () => {
  // tab 容器结构
  assert.match(source, /<div className="provider-detail">/);
  assert.match(source, /<SegmentedControl<ProviderTab>/);
  // 两个 tab 选项
  assert.match(source, /\{ value: "config", label: "服务商配置" \}/);
  assert.match(source, /\{ value: "models", label: "模型管理" \}/);
  // 服务商配置 tab 内嵌 ProviderFormView edit
  assert.match(
    source,
    /activeTab === "config" \? \(\s*<ProviderFormView nav=\{nav\} mode="edit" \/>/,
  );
});

test("T-T1: 默认 tab 是「服务商配置」（create 后直接可编辑）", () => {
  assert.match(source, /useState<ProviderTab>\("config"\)/);
});

test("T-SA1: 删模型批量模式接入全选（ManageHeader 传 onSelectAll/allSelected，重置语义）", () => {
  // ProviderDetailView 的 ManageHeader 传了全选 props
  assert.match(source, /allSelected=\{allModelsSelected\}/);
  assert.match(source, /onSelectAll=\{\(\) =>/);
  // 全选 = 重置为全部模型 id；已全选 = 清空
  assert.match(
    source,
    /allModelsSelected \? \[\] : models\.map\(\(m\) => m\.id\)/,
  );
});

test("T-T4: ProvidersView ContextMenu 无「编辑」项；handler 无 edit 分支", () => {
  // ProvidersView 的 ContextMenu items 不再含 编辑（重命名/删除保留）
  // 注意 ProviderDetailView 的模型菜单也有「编辑」项（模型编辑入口，保留），
  // 所以只断言 provider 菜单块不含 编辑。
  const providersViewStart = source.indexOf("export function ProvidersView");
  const providersViewEnd = source.indexOf(
    "export function ProviderFormView",
  );
  assert.ok(providersViewStart > -1 && providersViewEnd > providersViewStart);
  const providersSource = source.slice(providersViewStart, providersViewEnd);

  // 菜单 items 数组里没有 action: "edit"
  const menuItemsMatch = providersSource.match(
    /items=\{\[([\s\S]*?)\]\}/,
  );
  assert.ok(menuItemsMatch, "ProvidersView 应有 ContextMenu items");
  assert.doesNotMatch(menuItemsMatch![1], /action: "edit"/);
  assert.match(menuItemsMatch![1], /action: "rename"/);
  assert.match(menuItemsMatch![1], /action: "delete"/);

  // handler 无 edit 分支
  assert.doesNotMatch(
    providersSource,
    /if \(action === "edit"\)[\s\S]*?nav\.push\("providerEdit"\)/,
  );
});

test("T-T4: desktop 已废弃 providerEdit viewId（无残留引用）", () => {
  assert.doesNotMatch(source, /providerEdit/);
});
