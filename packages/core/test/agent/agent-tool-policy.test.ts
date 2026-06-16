import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerBuiltinTools, ToolError, ToolRegistry, ToolRunner } from "@novel-master/core";

import { AgentConfigError, resolveAgentToolRegistry, validateAgentDefinition, validateAgentToolPolicy, type AgentDefinition } from "@novel-master/core/agent";

import { toolsFromRegistry } from "@novel-master/core/provider";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";

const BASE_DEF: AgentDefinition = {
  name: "test",
  prompts: { persist: [], dynamic: [] },
};

function vfsRegistryNames(): string[] {
  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  return registry.list();
}

describe("agent tool policy", () => {
  const registryNames = new Set(vfsRegistryNames());

  it("T1: no tools config exposes all builtin tools", () => {
    const base = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(base);
    const filtered = resolveAgentToolRegistry(base, BASE_DEF);
    assert.deepEqual(filtered.list().sort(), vfsRegistryNames().sort());
    assert.equal(toolsFromRegistry(filtered).length, vfsRegistryNames().length);
  });

  it("T2: allow list restricts LLM tools", () => {
    const def: AgentDefinition = {
      ...BASE_DEF,
      tools: { allow: ["read", "grep"] },
    };
    const base = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(base);
    const filtered = resolveAgentToolRegistry(base, def);
    assert.deepEqual(filtered.list().sort(), ["grep", "read"]);
    assert.equal(toolsFromRegistry(filtered).length, 2);
    assert.equal(filtered.get("write"), undefined);
  });

  it("T3: empty allow yields no tools", () => {
    const def: AgentDefinition = {
      ...BASE_DEF,
      tools: { allow: [] },
    };
    const base = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(base);
    const filtered = resolveAgentToolRegistry(base, def);
    assert.deepEqual(filtered.list(), []);
    assert.equal(toolsFromRegistry(filtered).length, 0);
  });

  it("T4: deny list removes named tools", () => {
    const def: AgentDefinition = {
      ...BASE_DEF,
      tools: { deny: ["write"] },
    };
    const base = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(base);
    const filtered = resolveAgentToolRegistry(base, def);
    assert.ok(!filtered.list().includes("write"));
    assert.ok(filtered.list().includes("read"));
    assert.equal(filtered.list().length, vfsRegistryNames().length - 1);
  });

  it("T5: allow and deny together fails validation", () => {
    assert.throws(
      () =>
        validateAgentToolPolicy(
          { allow: ["read"], deny: ["write"] },
          registryNames,
        ),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "INVALID_TOOL_POLICY",
    );
  });

  it("accepts legacy vfs.* names in allow list", () => {
    const def: AgentDefinition = {
      ...BASE_DEF,
      tools: { allow: ["vfs.read", "vfs.grep"] },
    };
    const base = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(base);
    const filtered = resolveAgentToolRegistry(base, def);
    assert.deepEqual(filtered.list().sort(), ["grep", "read"]);
  });

  it("T6: unknown tool name fails validation", () => {
    assert.throws(
      () =>
        validateAgentToolPolicy({ allow: ["vfs.nope"] }, registryNames),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "INVALID_TOOL_POLICY",
    );
  });

  it("T9: legacy replace tool name fails validation with migration hint", () => {
    assert.throws(
      () => validateAgentToolPolicy({ allow: ["replace"] }, registryNames),
      (e: unknown) => {
        assert.ok(e instanceof AgentConfigError);
        assert.equal(e.code, "INVALID_TOOL_POLICY");
        assert.ok(e.message.includes("replace"));
        assert.ok(e.message.includes("edit"));
        return true;
      },
    );
  });

  it("validateAgentDefinition runs tool policy when names provided", async () => {
    await assert.rejects(
      () =>
        validateAgentDefinition(
          { ...BASE_DEF, tools: { allow: ["vfs.nope"] } },
          { registeredToolNames: vfsRegistryNames() },
        ),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "INVALID_TOOL_POLICY",
    );
  });

  it("empty deny matches default (all tools)", () => {
    const def: AgentDefinition = { ...BASE_DEF, tools: { deny: [] } };
    const base = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(base);
    const filtered = resolveAgentToolRegistry(base, def);
    assert.deepEqual(filtered.list().sort(), vfsRegistryNames().sort());
  });

  it("A10: allow read-only rejects fs with NOT_FOUND", async () => {
    const def: AgentDefinition = {
      ...BASE_DEF,
      tools: { allow: ["read", "grep"] },
    };
    const base = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(base);
    const filtered = resolveAgentToolRegistry(base, def);
    const runner = new ToolRunner(filtered);

    await assert.rejects(
      () => runner.call("fs", { command: "mv /a /b" }, {} as BuiltinToolContext),
      (e: unknown) => e instanceof ToolError && e.code === "NOT_FOUND",
    );
  });
});
