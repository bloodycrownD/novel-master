import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
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
const agentEditorPath = path.join(
  __dirname,
  "..",
  "renderer",
  "features",
  "settings",
  "AgentEditorView.tsx",
);
const shellCssPath = path.join(
  __dirname,
  "..",
  "renderer",
  "styles",
  "shell.css",
);
const agentWorkplaceBlockCardPath = path.join(
  __dirname,
  "..",
  "renderer",
  "features",
  "settings",
  "AgentWorkplaceBlockCard.tsx",
);
const appPath = path.join(__dirname, "..", "renderer", "App.tsx");

describe("AgentsSettingsView 双 tab（agent-config-tabs T-D3）", () => {
  it("tab 化：SegmentedControl 置顶 + agentModeMatchesTab 前端过滤 + 新建随 tab 落库", () => {
    const source = readFileSync(settingsViewsPath, "utf8");
    // tabs 容器与分段控件（主 / 子双 tab，主为默认值）
    assert.match(source, /agents-manage__tabs/);
    assert.match(source, /SegmentedControl/);
    assert.match(source, /label: "主智能体"/);
    assert.match(source, /label: "子智能体"/);
    // 过滤口径收口 core：agentModeMatchesTab(row.mode, tab)
    assert.match(source, /agentModeMatchesTab\(row\.mode, tab\)/);
    // 新建默认作用域随 tab 落库
    assert.match(
      source,
      /ipcAgentRegistryCreateBlank\(\{\s*mode: tab === "primary" \? "primary" : "subagent",\s*\}\)/,
    );
  });

  it("general 合成行：sentinel + 「内置」徽标 + 不进批量/删除（remaining 排除）", () => {
    const source = readFileSync(settingsViewsPath, "utf8");
    // sentinel 常量与真实 `agent-<ts>` id 不冲突
    assert.match(source, /GENERAL_AGENT_ID = "general"/);
    // 「内置」徽标（settings-tag--primary）
    assert.match(source, /settings-tag settings-tag--primary">\s*内置\s*</);
    // 「全部」徽标（mode 为 all 或缺省的行）
    assert.match(source, /settings-tag settings-tag--muted">\s*全部\s*</);
    // 删除兜底 remaining 排除 general 合成行
    assert.match(
      source,
      /id !== GENERAL_AGENT_ID/,
    );
    // 菜单仅「查看」
    assert.match(source, /\{ label: "查看", action: "view" \}/);
  });

  it("AgentEditorView general 只读分支：sentinel 短路 + 出厂常量填充完整表单 + 全禁用接线", () => {
    const source = readFileSync(agentEditorPath, "utf8");
    // sentinel 分支存在：loadAgent 短路不经 ipcAgentRegistryGet（必 404）
    assert.match(source, /agentId === GENERAL_AGENT_ID/);
    // 数据源为镜像导出的出厂常量（DEFAULT_SUBAGENT_DEFINITION 直填表单 state）
    assert.match(source, /applyDefinition\(DEFAULT_SUBAGENT_DEFINITION, null\)/);
    // 顶层派生 isBuiltin 并接线到全部 input/textarea/select/switch/按钮
    assert.match(source, /const isBuiltin = agentId === GENERAL_AGENT_ID/);
    const disabledCount =
      (source.match(/disabled=\{isBuiltin\}/g) ?? []).length;
    assert.ok(
      disabledCount >= 20,
      `disabled={isBuiltin} 接线数量不足：${disabledCount}`,
    );
    // 保存按钮保留渲染但禁用（与其他 agent 布局一致）
    assert.match(source, /disabled=\{saving \|\| isBuiltin\}/);
    // 顶部说明条保留「内置智能体，不可编辑」文案（挪入表单 desc）
    assert.match(source, /内置智能体，不可编辑/);
  });

  it("shell.css 含 .agents-manage__tabs（复刻技能页 tabs 容器样式）", () => {
    const css = readFileSync(shellCssPath, "utf8");
    assert.match(css, /\.agents-manage__tabs\s*\{/);
  });
});

describe("CR 修复防回归（cr-fix-spec f1/B-001 + f1/A-003 desktop 半）", () => {
  it("AgentWorkplaceBlockCard：PromptCollapsibleField 透传 disabled（堵 general 只读态全屏编辑绕过）", () => {
    const source = readFileSync(agentWorkplaceBlockCardPath, "utf8");
    // 全屏编辑按钮禁用经由 disabled={disabled} 透传（同卡 Switch / textarea 均已接）
    assert.match(
      source,
      /<PromptCollapsibleField[^>]*disabled=\{disabled\}/,
    );
  });

  it("general 合成行：行内用短文案「通用助手 · 不可编辑」，不再引用完整 description", () => {
    const source = readFileSync(settingsViewsPath, "utf8");
    // 双端文案对齐：mobile AgentList 合成行同款
    assert.match(source, /通用助手 · 不可编辑/);
    // 详情页完整描述走 AgentEditorView 的 applyDefinition，本文件不应再引用 description
    assert.doesNotMatch(source, /DEFAULT_SUBAGENT_DEFINITION\.description/);
  });
});

// ── S-D-04 接线兜底（**弱观测**，只锁接线不锁行为；主验收是
//    agent-editor-dirty-guard.test.tsx 的 T-SD04-1/2 行为断言）────────────
describe("S-D-04 dirty 上报与 ⚙ 关闭接线（弱观测兜底）", () => {
  it("AgentEditorView 上报 dirtyViews.add('agentEditor') 并带卸载清理", () => {
    const source = readFileSync(agentEditorPath, "utf8");
    assert.match(source, /nav\.dirtyViews\.add\("agentEditor"\)/);
    assert.match(source, /nav\.dirtyViews\.delete\("agentEditor"\)/);
    // 卸载清理：effect 必须 return 一个 cleanup
    assert.match(
      source,
      /return \(\) => \{\s*nav\.dirtyViews\.delete\("agentEditor"\);/,
    );
  });

  it("App.tsx 的 ⚙ 不再直接 toggle settingsOpen（改走 Overlay 的 requestClose）", () => {
    const source = readFileSync(appPath, "utf8");
    assert.doesNotMatch(
      source,
      /onToggleSettings=\{\(\) => setSettingsOpen\(open => !open\)\}/,
    );
    // 关闭收归 Overlay 内的 handleClose（守卫 + onClose 副作用单点）
    assert.match(source, /settingsOverlayRef\.current\?\.requestClose\(\)/);
    assert.match(source, /<SettingsOverlay\s+ref=\{settingsOverlayRef\}/);
  });

  it("AgentEditorView 不再出现「找不到模型就传 null」的表达式（E 形态守卫）", () => {
    const source = readFileSync(agentEditorPath, "utf8");
    assert.doesNotMatch(source, /pinned != null\s*\?\s*\{providerId/);
    // 新的第三形态必须真的存在于代码里（否则这条守卫是恒真的废断言）
    assert.match(source, /unresolved: true as const, rawId: def\.model/);
  });
});
