import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  BuiltinTools, ToolRegistry  } from "@novel-master/core";
import {  ToolDefinitions  } from "@novel-master/core/llm-protocol";

describe("ToolDefinitions.fromRegistry parameter descriptions", () => {
    it("edit tool schema includes property descriptions for LLM", () => {
        const registry = new ToolRegistry();
        BuiltinTools.register(registry);
        const edit = ToolDefinitions.fromRegistry(registry, { subagent: { callableAgents: [{ name: "general" }] } }).find((t) => t.name === "edit");
        assert.ok(edit);
        assert.match(edit!.description, /尾追/);

        const schema = edit!.inputSchema as {
            properties?: Record<string, { description?: string }>;
        };
        assert.equal(typeof schema.properties?.path?.description, "string");
        assert.equal(typeof schema.properties?.oldString?.description, "string");
        assert.equal(typeof schema.properties?.newString?.description, "string");
        assert.match(schema.properties!.oldString!.description!, /唯一/);
    });

    it("registers 12 builtin tools (incl. mcp placeholder) without chat_grep", () => {
        const registry = new ToolRegistry();
        BuiltinTools.register(registry);
        assert.equal(registry.list().length, 12);
        assert.ok(!registry.list().includes("chat_grep"));
    });
});
