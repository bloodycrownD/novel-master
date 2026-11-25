import assert from "node:assert/strict";
import test from "node:test";

import { AgentToolCatalog, BUILTIN_TOOL_CATALOG } from "../../shared/config-forms/agent-tool-catalog.js";

/**
 * T-AG5：catalog 计数同步锁。
 *
 * BUILTIN_TOOL_CATALOG 是双端 ToolPolicyPicker 的数据源（计数走
 * `BUILTIN_TOOL_CATALOG.length` 自动适应），`search` 工具上线后为 11 条。
 * 本用例锁总数与 agent 条目口径，防止后续增删内置工具时 catalog 与
 * registerBuiltinTools 注册表失同步。
 */
test("BUILTIN_TOOL_CATALOG 含 agent 共 11 条（T-AG5）", () => {
    assert.equal(BUILTIN_TOOL_CATALOG.length, 11);

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

test("AgentToolCatalog.get 分组结构：builtin 照旧 + mcp 追加（spec §九）", () => {
    const groups = AgentToolCatalog.get({ mcpTools: () => [] });
    assert.deepEqual(groups.map((g) => g.id), ["builtin", "mcp"]);
    assert.ok(groups[0].entries === BUILTIN_TOOL_CATALOG, "builtin 分组应复用静态常量原引用");
});

test("AgentToolCatalog.get 空快照回落「未配置 MCP 服务器」单项提示（不参与勾选与计数）", () => {
    const mcp = AgentToolCatalog.get({ mcpTools: () => [] })[1].entries;
    assert.equal(mcp.length, 1);
    assert.equal(mcp[0].placeholder, true);
    assert.equal(mcp[0].description, "未配置 MCP 服务器");
});

test("AgentToolCatalog.get 快照条目映射为 mcp__ 复合名条目（名字与描述取快照，不在 app 侧重算）", () => {
    const mcp = AgentToolCatalog.get({
        mcpTools: () => [
            { registeredName: "mcp__fs__read", serverId: "fs", toolDescription: "Read files" },
            { registeredName: "mcp__fs__write", serverId: "fs" },
        ],
    })[1].entries;
    assert.equal(mcp.length, 2);
    assert.equal(mcp[0].name, "mcp__fs__read");
    assert.equal(mcp[0].label, "mcp__fs__read");
    assert.equal(mcp[0].description, "[MCP:fs] Read files");
    assert.equal(mcp[0].placeholder, undefined);
    assert.equal(mcp[1].description, "[MCP:fs] mcp__fs__write", "toolDescription 缺省回落 registeredName");
});
