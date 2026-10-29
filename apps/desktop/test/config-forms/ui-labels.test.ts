import assert from "node:assert/strict";
import test from "node:test";
import {
  API_KEY_STATUS_LABELS,
} from "../../shared/config-forms/ui-labels.js";

test("API_KEY_STATUS_LABELS 映射 set/notSet 为中文", () => {
  assert.equal(API_KEY_STATUS_LABELS.set, "已连接");
  assert.equal(API_KEY_STATUS_LABELS.notSet, "未连接");
});

test("ui-labels 可从 config-forms 根入口导出", async () => {
  const root = await import("../../shared/config-forms/index.js");
  assert.equal(root.API_KEY_STATUS_LABELS.set, "已连接");
});
