import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentDefinition } from "../../src/domain/agent/model/agent-definition.js";
import { McpToolRefs, type AgentToolRefRegistry } from "../../src/domain/mcp/logic/rewrite-mcp-tool-references.js";
import { AppErrorOps } from "../../src/errors/app-error.js";
import { fakeMcpAgentRegistry } from "../helpers/mcp-fake-agent-registry.js";
import { unwrap, unwrapErr } from "../helpers/result-unwrap.js";

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

describe("McpToolRefs.rewriteAgentTools", () => {
    it("命中的 agent 写回、未命中的不写回；反向调用即回滚", async () => {
        const registry = fakeMcpAgentRegistry({ hit: { name: "hit", prompts: { persist: [], dynamic: [] }, tools: { allow: ["mcp__old__query", "task"], deny: ["mcp__old__write"] } }, miss: { name: "miss", prompts: { persist: [], dynamic: [] } } });
        unwrap(await McpToolRefs.rewriteAgentTools(registry, "old", "new"));
        assert.deepEqual(registry.upserted, ["hit"]);
        assert.deepEqual(registry.defs.get("hit")?.tools, { allow: ["mcp__new__query", "task"], deny: ["mcp__new__write"] });
        unwrap(await McpToolRefs.rewriteAgentTools(registry, "new", "old"));
        assert.deepEqual(registry.defs.get("hit")?.tools, { allow: ["mcp__old__query", "task"], deny: ["mcp__old__write"] });
    });

    it("写回失败返回 err（带 agentId），不 throw", async () => {
        const registry = fakeMcpAgentRegistry({ hit: { name: "hit", prompts: { persist: [], dynamic: [] }, tools: { allow: ["mcp__old__query"] } } });
        registry.failNext();
        const failed = unwrapErr(await McpToolRefs.rewriteAgentTools(registry, "old", "new"));
        assert.ok(AppErrorOps.is(failed, "INFRA_UNEXPECTED_ERROR"));
        assert.ok(failed.message.includes("hit"));
    });
});
