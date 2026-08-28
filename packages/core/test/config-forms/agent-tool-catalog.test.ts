import assert from "node:assert/strict";
import test from "node:test";

import { BUILTIN_TOOL_CATALOG } from "../../src/config-forms/agent/agent-tool-catalog.js";

/**
 * T-AG5：catalog 计数同步锁。
 *
 * BUILTIN_TOOL_CATALOG 是双端 ToolPolicyPicker 的数据源（计数走
 * `BUILTIN_TOOL_CATALOG.length` 自动适应），`curl` 工具上线后为 10 条。
 * 本用例锁总数与 agent 条目口径，防止后续增删内置工具时 catalog 与
 * registerBuiltinTools 注册表失同步。
 */
test("BUILTIN_TOOL_CATALOG 含 agent 共 10 条（T-AG5）", () => {
  assert.equal(BUILTIN_TOOL_CATALOG.length, 10);

  const agent = BUILTIN_TOOL_CATALOG.find((e) => e.name === "agent");
  assert.ok(agent, "catalog 缺 agent 条目");
  assert.equal(agent.label, "agent");
  // 描述口径照 skill 条目：动作清单括注 + 可用性说明。
  assert.match(agent.description, /list\/get\/create\/update/);
  assert.match(agent.description, /仅主智能体可用/);
});

test("BUILTIN_TOOL_CATALOG 含 curl 条目（与 registerBuiltinTools 同步）", () => {
  const curl = BUILTIN_TOOL_CATALOG.find((e) => e.name === "curl");
  assert.ok(curl, "catalog 缺 curl 条目");
  assert.equal(curl.label, "curl");
  assert.ok(curl.description.length > 0, "curl 条目描述不应为空");
  assert.match(curl.description, /方法/);
  assert.match(curl.description, /请求头/);
});

test("BUILTIN_TOOL_CATALOG 条目字段完整（name/label/description）", () => {
  for (const entry of BUILTIN_TOOL_CATALOG) {
    assert.equal(typeof entry.name, "string");
    assert.equal(entry.label, entry.name);
    assert.equal(typeof entry.description, "string");
    assert.ok(entry.description.length > 0);
  }
});
