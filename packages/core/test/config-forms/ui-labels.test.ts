import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_LIST_LABELS,
  API_KEY_STATUS_LABELS,
  REGEX_UI_LABELS,
  SESSION_FS_LABELS,
} from "../../src/config-forms/shared/ui-labels.js";

test("API_KEY_STATUS_LABELS 映射 set/notSet 为中文", () => {
  assert.equal(API_KEY_STATUS_LABELS.set, "已连接");
  assert.equal(API_KEY_STATUS_LABELS.notSet, "未连接");
});

test("SESSION_FS_LABELS 提供标题与开关联动 hint", () => {
  assert.equal(SESSION_FS_LABELS.title, "文件版本校验");
  assert.equal(SESSION_FS_LABELS.enabledHint, "已开启版本校验");
  assert.equal(SESSION_FS_LABELS.disabledHint, "已关闭版本校验");
});

test("REGEX_UI_LABELS 深度与通道为主中文文案", () => {
  assert.equal(REGEX_UI_LABELS.startDepth, "开始深度");
  assert.equal(REGEX_UI_LABELS.endDepth, "结束深度");
  assert.equal(REGEX_UI_LABELS.previewDepth, "预览消息深度");
  assert.equal(REGEX_UI_LABELS.promptChannel, "提示词通道");
  assert.equal(REGEX_UI_LABELS.displayChannel, "展示通道");
  assert.match(REGEX_UI_LABELS.previewDepthHint, /样例文本试跑/);
});

test("AGENT_LIST_LABELS 提供需修复与最大步数文案", () => {
  assert.equal(AGENT_LIST_LABELS.needsRepair, "需修复");
  assert.equal(AGENT_LIST_LABELS.maxSteps(12), "最大步数 12");
});

test("ui-labels 可从 config-forms shared 入口导出", async () => {
  const shared = await import("../../src/config-forms/shared/index.js");
  assert.equal(shared.API_KEY_STATUS_LABELS.set, "已连接");
  assert.equal(shared.SESSION_FS_LABELS.title, "文件版本校验");
});

test("ui-labels 可从 config-forms 根入口重导出", async () => {
  const root = await import("../../src/config-forms/index.js");
  assert.equal(root.REGEX_UI_LABELS.startDepth, "开始深度");
  assert.equal(root.AGENT_LIST_LABELS.needsRepair, "需修复");
});
