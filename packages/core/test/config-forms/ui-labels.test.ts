import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_LIST_LABELS,
  API_KEY_STATUS_LABELS,
} from "../../src/config-forms/shared/ui-labels.js";

test("API_KEY_STATUS_LABELS 映射 set/notSet 为中文", () => {
  assert.equal(API_KEY_STATUS_LABELS.set, "已连接");
  assert.equal(API_KEY_STATUS_LABELS.notSet, "未连接");
});

test("AGENT_LIST_LABELS 提供需修复与最大步数文案", () => {
  assert.equal(AGENT_LIST_LABELS.needsRepair, "需修复");
  assert.equal(AGENT_LIST_LABELS.maxSteps(12), "最大步数 12");
});

test("ui-labels 可从 config-forms shared 入口导出", async () => {
  const shared = await import("../../src/config-forms/shared/index.js");
  assert.equal(shared.API_KEY_STATUS_LABELS.set, "已连接");
  assert.equal(shared.AGENT_LIST_LABELS.needsRepair, "需修复");
});

test("ui-labels 可从 config-forms 根入口重导出", async () => {
  const root = await import("../../src/config-forms/index.js");
  assert.equal(root.AGENT_LIST_LABELS.needsRepair, "需修复");
});
