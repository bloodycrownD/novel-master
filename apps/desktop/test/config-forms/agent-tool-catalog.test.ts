import assert from "node:assert/strict";
import test from "node:test";

import { BUILTIN_TOOL_CATALOG } from "../../shared/config-forms/agent-tool-catalog.js";

/**
 * T-D4：catalog 计数同步锁（与移动端 T-MO4 同口径）。
 *
 * BUILTIN_TOOL_CATALOG 是双端 ToolPolicyPicker 的数据源（计数走
 * `BUILTIN_TOOL_CATALOG.length` 自动适应），`mcp` 占位工具并入后为 12 条
 * （11 个自带 + mcp）。本用例锁总数与 mcp / agent 条目口径，防止后续增删
 * 内置工具时 catalog 与 BuiltinTools.register 注册表失同步。
 */
test("BUILTIN_TOOL_CATALOG 含 agent 共 12 条：11 个自带 + mcp（T-D4）", () => {
    assert.equal(BUILTIN_TOOL_CATALOG.length, 12);

    const agent = BUILTIN_TOOL_CATALOG.find((e) => e.name === "agent");
    assert.ok(agent, "catalog 缺 agent 条目");
    assert.equal(agent.label, "agent");
    // 描述口径照 skill 条目：动作清单括注 + 可用性说明。
    assert.match(agent.description, /list\/get\/create\/update/);
    assert.match(agent.description, /仅主智能体可用/);
});

test("BUILTIN_TOOL_CATALOG 含 mcp 条目（抽象开关，描述只说事实；T-D4）", () => {
    const mcp = BUILTIN_TOOL_CATALOG.find((e) => e.name === "mcp");
    assert.ok(mcp, "catalog 缺 mcp 条目");
    assert.equal(mcp.label, "mcp");
    assert.equal(mcp.description, "MCP 服务器提供的工具");
});

test("BUILTIN_TOOL_CATALOG 含 curl 条目（与 registerBuiltinTools 同步）", () => {
    const curl = BUILTIN_TOOL_CATALOG.find((e) => e.name === "curl");
    assert.ok(curl, "catalog 缺 curl 条目");
    assert.equal(curl.label, "curl");
    assert.ok(curl.description.length > 0, "curl 条目描述不应为空");
    assert.match(curl.description, /方法/);
    assert.match(curl.description, /请求头/);
});

test("BUILTIN_TOOL_CATALOG 含 search 条目（与 registerBuiltinTools 同步）", () => {
    const search = BUILTIN_TOOL_CATALOG.find((e) => e.name === "search");
    assert.ok(search, "catalog 缺 search 条目");
    assert.equal(search.label, "search");
    assert.ok(search.description.length > 0, "search 条目描述不应为空");
    assert.match(search.description, /搜索/);
    assert.match(search.description, /串行检索/);
    assert.match(search.description, /设置 → 搜索配置/);
    assert.ok(!/bocha/.test(search.description), "search 条目描述不应枚举五引擎 id");
});

test("BUILTIN_TOOL_CATALOG 条目字段完整（name/label/description）", () => {
    for (const entry of BUILTIN_TOOL_CATALOG) {
        assert.equal(typeof entry.name, "string");
        assert.equal(entry.label, entry.name);
        assert.equal(typeof entry.description, "string");
        assert.ok(entry.description.length > 0);
    }
});
