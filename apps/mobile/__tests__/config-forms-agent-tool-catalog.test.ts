import assert from "node:assert/strict";
import { it } from "@jest/globals";

import {AgentToolCatalog, BUILTIN_TOOL_CATALOG} from "@/config-forms/agent/agent-tool-catalog";

/**
 * T-AG5 / T-MO4：catalog 计数同步锁。
 *
 * BUILTIN_TOOL_CATALOG 是双端 ToolPolicyPicker 的数据源（计数走
 * `BUILTIN_TOOL_CATALOG.length` 自动适应），mcp 占位进名单后为 12 条
 * （11 个自带 + mcp）。本用例锁总数、agent / curl / search / mcp 条目口径，
 * 防止后续增删内置工具时 catalog 与 registerBuiltinTools 注册表失同步。
 */
it("BUILTIN_TOOL_CATALOG 含 agent 共 12 条（T-MO4：11 自带 + mcp 占位）", () => {
    assert.equal(BUILTIN_TOOL_CATALOG.length, 12);

    const agent = BUILTIN_TOOL_CATALOG.find((e) => e.name === "agent");
    assert.ok(agent, "catalog 缺 agent 条目");
    assert.equal(agent.label, "agent");
    // 描述口径照 skill 条目：动作清单括注 + 可用性说明。
    assert.match(agent.description, /list\/get\/create\/update/);
    assert.match(agent.description, /仅主智能体可用/);
});

it("mcp 是与其他工具平等的第 12 条：描述来自 core i18n 的 tool_desc_mcp（spec §D）", () => {
    const mcp = BUILTIN_TOOL_CATALOG.find((e) => e.name === "mcp");
    assert.ok(mcp, "catalog 缺 mcp 条目");
    assert.equal(mcp.label, "mcp");
    assert.equal(mcp.description, "MCP 服务器提供的工具");
    assert.deepEqual(BUILTIN_TOOL_CATALOG.filter((e) => e.name === "mcp").length, 1, "mcp 条目不得重复");
});

it("BUILTIN_TOOL_CATALOG 含 curl 条目（与 registerBuiltinTools 同步）", () => {
    const curl = BUILTIN_TOOL_CATALOG.find((e) => e.name === "curl");
    assert.ok(curl, "catalog 缺 curl 条目");
    assert.equal(curl.label, "curl");
    assert.ok(curl.description.length > 0, "curl 条目描述不应为空");
    assert.match(curl.description, /方法/);
    assert.match(curl.description, /请求头/);
});

it("BUILTIN_TOOL_CATALOG 含 search 条目（与 registerBuiltinTools 同步）", () => {
    const search = BUILTIN_TOOL_CATALOG.find((e) => e.name === "search");
    assert.ok(search, "catalog 缺 search 条目");
    assert.equal(search.label, "search");
    assert.ok(search.description.length > 0, "search 条目描述不应为空");
    assert.match(search.description, /搜索/);
    assert.match(search.description, /串行检索/);
    assert.match(search.description, /设置 → 搜索配置/);
    assert.ok(!/bocha/.test(search.description), "search 条目描述不应枚举五引擎 id");
});

it("BUILTIN_TOOL_CATALOG 条目字段完整（name/label/description）", () => {
    for (const entry of BUILTIN_TOOL_CATALOG) {
        assert.equal(typeof entry.name, "string");
        assert.equal(entry.label, entry.name);
        assert.equal(typeof entry.description, "string");
        assert.ok(entry.description.length > 0);
    }
});

it("AgentToolCatalog.get 返回单组（spec §D：mcp 已并入名单，不再动态分组）", () => {
    const groups = AgentToolCatalog.get();
    assert.deepEqual(groups.map(g => g.id), ['builtin']);
    assert.ok(groups[0].entries === BUILTIN_TOOL_CATALOG, 'builtin 分组应复用静态常量原引用');
});
