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

  it("AgentEditorView general 只读分支：sentinel 短路 + 出厂常量展示 + 不可编辑说明", () => {
    const source = readFileSync(agentEditorPath, "utf8");
    assert.match(source, /agentId === GENERAL_AGENT_ID/);
    assert.match(source, /DEFAULT_SUBAGENT_DEFINITION/);
    assert.match(source, /内置智能体，不可编辑/);
  });

  it("shell.css 含 .agents-manage__tabs（复刻技能页 tabs 容器样式）", () => {
    const css = readFileSync(shellCssPath, "utf8");
    assert.match(css, /\.agents-manage__tabs\s*\{/);
  });
});
