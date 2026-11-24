import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { McpToolSlug } from "../../src/domain/mcp/logic/slugify-mcp-tool-name.js";

describe("slugify-mcp-tool-name", () => {
    it("T-M3: 短名原样输出，字符集归一到 [a-zA-Z0-9_-]", () => {
        assert.equal(McpToolSlug.toolName("fs", "read"), "mcp__fs__read");
        assert.equal(McpToolSlug.toolName("big-server.v2", "query.rows"), "mcp__big-server_v2__query_rows");
        const cjk = McpToolSlug.toolName("我的 服务器", "查询 工具!");
        assert.ok(cjk.startsWith("mcp__"));
        assert.match(cjk, /^[a-zA-Z0-9_-]+$/);
    });

    it("T-M3: 超长名截断到 64 字符并保留 8 位短哈希；哈希输入是完整未截断名（确定性且可区分）", () => {
        const name = McpToolSlug.toolName("big-server", "a".repeat(80));
        assert.equal(name.length, 64);
        assert.match(name, /_[0-9a-f]{8}$/);
        assert.ok(name.startsWith("mcp__big-server__"));
        // 确定性：同输入同输出
        assert.equal(name, McpToolSlug.toolName("big-server", "a".repeat(80)));
        // 截断前缀相同、全名不同的两个名字靠哈希区分
        const sibling = McpToolSlug.toolName("big-server", "a".repeat(79) + "b");
        assert.notEqual(name, sibling);
        assert.equal(sibling.length, 64);
        assert.equal(sibling.slice(0, 55), name.slice(0, 55));
    });
});
