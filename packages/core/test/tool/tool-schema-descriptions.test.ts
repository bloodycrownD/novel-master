import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerBuiltinTools, ToolRegistry } from "@novel-master/core";
import { toolsFromRegistry } from "@novel-master/core/provider";

describe("toolsFromRegistry parameter descriptions", () => {
  it("edit tool schema includes property descriptions for LLM", () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const edit = toolsFromRegistry(registry).find((t) => t.name === "edit");
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

  it("registers 6 builtin tools without chat_grep", () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    assert.equal(registry.list().length, 6);
    assert.ok(!registry.list().includes("chat_grep"));
  });
});
