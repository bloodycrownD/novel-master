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
const sharedLogicSmartSortPath = path.join(
  __dirname,
  "..",
  "shared",
  "logic",
  "smart-sort.ts",
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

describe("SmartSortRuleEditorView 高亮切分单源（dtcli/G-1）", () => {
  const source = readFileSync(settingsViewsPath, "utf8");

  it("G-1：高亮切分消费 shared/logic 再导出的 core 单源，本地实现已删", () => {
    // 本地实现删除（formerly line-by-line isomorphic copy）
    assert.doesNotMatch(source, /function splitSmartSortHighlightSegments\(/);
    // renderer 经 @shared/logic/smart-sort 薄再导出消费（X1 gate：不直连 core）
    assert.match(
      source,
      /import \{\s*formatPatternInput,\s*parsePatternInput,\s*splitSmartSortHighlightSegments,\s*\} from "@shared\/logic\/smart-sort";/,
    );
    // shared 薄层确实再导出 core 单源
    const shared = readFileSync(sharedLogicSmartSortPath, "utf8");
    assert.match(
      shared,
      /splitSmartSortHighlightSegments,\s*\} from "@novel-master\/core\/smart-sort-rule";/,
    );
  });
});

describe("SmartSortRuleEditorView 评审修复 round 4（dtcli/B-1/B-2/B-3）", () => {
  const source = readFileSync(settingsViewsPath, "utf8");

  it("B-1：三个输入入口（测试文本/正则/捕获档）变化即清 matchResult/testError", () => {
    // 清空 helper：结果与错误一起清（结果只属于上次点击「测试」时的输入快照）
    assert.match(
      source,
      /const invalidateMatchResult = useCallback\(\(\) => \{\s*setMatchResult\(null\);\s*setTestError\(null\);\s*\}, \[\]\);/,
    );
    // 测试文本 onChange
    assert.match(
      source,
      /onChange=\{\(e\) => \{\s*setTestText\(e\.target\.value\);\s*invalidateMatchResult\(\);\s*\}\}/,
    );
    // 正则输入 onChange
    assert.match(
      source,
      /setDraft\(applySmartSortPatternInput\(draft, e\.target\.value\)\);\s*invalidateMatchResult\(\);/,
    );
    // 捕获档 select onChange
    assert.match(
      source,
      /captureKind: e\.target\.value as SmartSortCaptureKindDto,\s*\}\);\s*invalidateMatchResult\(\);/,
    );
  });

  it("B-1：清空后结果区回 idle 占位文案（源码级断言，偏弱：锁占位分支存在）", () => {
    assert.match(
      source,
      /: \(\s*"输入测试文本后点击「测试」查看匹配结果。"\s*\)\)/,
    );
  });

  it("B-2：save 前置 trim + 空名本地拦截（不达 IPC）", () => {
    assert.match(
      source,
      /const name = draft\.name\.trim\(\);\s*if \(!name\) \{\s*toastSettingsError\("请填写规则名称"\);\s*return;\s*\}/,
    );
    // payload 用 trim 后的 name；空名短路 return 在构造 IPC 请求之前
    assert.match(
      source,
      /const payload = \{\s*name,\s*pattern: parsed\.pattern,/,
    );
  });

  it("B-3：编辑器规则列表加载失败出 toast，不静默伪装空态", () => {
    assert.match(
      source,
      /if \(!res\.ok\) \{\s*\/\/ 加载失败不可静默[\s\S]*?toastSettingsError\(res\.error\.message\);\s*return;/,
    );
  });
});
