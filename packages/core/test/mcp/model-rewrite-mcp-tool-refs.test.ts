import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { McpToolRefs } from "../../src/domain/mcp/logic/rewrite-mcp-tool-references.js";

describe("McpToolRefs.rewriteNames", () => {
    it("旧 ID 前缀的条目改写到新 ID，名单其余条目原样", () => {
        const rewritten = McpToolRefs.rewriteNames(["mcp__old__query", "mcp__other__read", "task", "mcp__old__write_file"], "old", "new");
        assert.deepEqual(rewritten, ["mcp__new__query", "mcp__other__read", "task", "mcp__new__write_file"]);
    });

    it("前缀带双下划线边界：ID 前缀重叠（old 与 ol）不互相误伤", () => {
        const rewritten = McpToolRefs.rewriteNames(["mcp__ol__tool", "mcp__old__tool"], "old", "new");
        assert.deepEqual(rewritten, ["mcp__ol__tool", "mcp__new__tool"]);
    });

    it("无命中时返回原数组引用（调用方据此跳过写回）", () => {
        const names = ["task", "mcp__other__read"];
        assert.equal(McpToolRefs.rewriteNames(names, "old", "new"), names);
        const empty: readonly string[] = [];
        assert.equal(McpToolRefs.rewriteNames(empty, "old", "new"), empty);
    });
});
