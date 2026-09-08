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

describe("SmartSortRulesView 评审修复（desktop/B-1、B-2、C-1）", () => {
  const source = readFileSync(settingsViewsPath, "utf8");

  it("B-1：列表加载失败出错误 toast 并标记 loadFailed", () => {
    assert.match(
      source,
      /if \(!res\.ok\) \{\s*\/\/ 加载失败不可伪装成「暂无规则」[^\n]*\n\s*toastSettingsError\(res\.error\.message\);\s*\n\s*setLoadFailed\(true\);/,
    );
    // 成功路径复位 loadFailed，避免下次空态误报「加载失败」
    assert.match(source, /setLoadFailed\(false\);\s*\n\s*setRules\(\[\.\.\.res\.data\]\);/);
  });

  it("B-1：空态文案区分「加载失败」与「暂无规则」", () => {
    assert.match(source, /\{loadFailed\s*\n\s*\? "加载失败，请重试。"\s*\n\s*: "暂无规则，点击上方按钮创建。"\}/);
  });

  it("B-2：ruleId 缺失时提示「规则不存在或已被删除」并回退新建语义", () => {
    assert.match(source, /toastSettingsError\("规则不存在或已被删除"\);/);
    assert.match(source, /setRuleId\(undefined\);/);
    // navState 同步清空（overlay 标题基线）
    assert.match(
      source,
      /\(\s*nav\.navState as \{ editingSmartSortRuleId\?: string \}\s*\)\.editingSmartSortRuleId = undefined;/,
    );
  });

  it("C-1：drop 源 id 优先 dataTransfer.getData、state 闭包兜底", () => {
    assert.match(
      source,
      /const sourceId = e\.dataTransfer\.getData\("text\/plain"\) \|\| dragRuleId;/,
    );
    assert.match(source, /void handleDrop\(e, rule\.ruleId\);/);
  });
});
