import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AgentConfigError,
  registerVfsTools,
  resolveAgentToolRegistry,
  toolsFromRegistry,
  ToolRegistry,
  validateAgentDefinition,
  validateAgentToolPolicy,
  type AgentDefinition,
} from "@novel-master/core";

const BASE_DEF: AgentDefinition = {
  name: "test",
  prompts: [{ name: "c", type: "chat" }],
};

function vfsRegistryNames(): string[] {
  const registry = new ToolRegistry();
  registerVfsTools(registry);
  return registry.list();
}

describe("agent tool policy", () => {
  const registryNames = new Set(vfsRegistryNames());

  it("T1: no tools config exposes all vfs tools", () => {
    const base = new ToolRegistry();
    registerVfsTools(base);
    const filtered = resolveAgentToolRegistry(base, BASE_DEF);
    assert.deepEqual(filtered.list().sort(), vfsRegistryNames().sort());
    assert.equal(toolsFromRegistry(filtered).length, vfsRegistryNames().length);
  });

  it("T2: allow list restricts LLM tools", () => {
    const def: AgentDefinition = {
      ...BASE_DEF,
      tools: { allow: ["vfs.read", "vfs.grep"] },
    };
    const base = new ToolRegistry();
    registerVfsTools(base);
    const filtered = resolveAgentToolRegistry(base, def);
    assert.deepEqual(filtered.list().sort(), ["vfs.grep", "vfs.read"]);
    assert.equal(toolsFromRegistry(filtered).length, 2);
    assert.equal(filtered.get("vfs.write"), undefined);
  });

  it("T3: empty allow yields no tools", () => {
    const def: AgentDefinition = {
      ...BASE_DEF,
      tools: { allow: [] },
    };
    const base = new ToolRegistry();
    registerVfsTools(base);
    const filtered = resolveAgentToolRegistry(base, def);
    assert.deepEqual(filtered.list(), []);
    assert.equal(toolsFromRegistry(filtered).length, 0);
  });

  it("T4: deny list removes named tools", () => {
    const def: AgentDefinition = {
      ...BASE_DEF,
      tools: { deny: ["vfs.write"] },
    };
    const base = new ToolRegistry();
    registerVfsTools(base);
    const filtered = resolveAgentToolRegistry(base, def);
    assert.ok(!filtered.list().includes("vfs.write"));
    assert.ok(filtered.list().includes("vfs.read"));
    assert.equal(filtered.list().length, vfsRegistryNames().length - 1);
  });

  it("T5: allow and deny together fails validation", () => {
    assert.throws(
      () =>
        validateAgentToolPolicy(
          { allow: ["vfs.read"], deny: ["vfs.write"] },
          registryNames,
        ),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "INVALID_TOOL_POLICY",
    );
  });

  it("T6: unknown tool name fails validation", () => {
    assert.throws(
      () =>
        validateAgentToolPolicy({ allow: ["vfs.nope"] }, registryNames),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "INVALID_TOOL_POLICY",
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
    const base = new ToolRegistry();
    registerVfsTools(base);
    const filtered = resolveAgentToolRegistry(base, def);
    assert.deepEqual(filtered.list().sort(), vfsRegistryNames().sort());
  });
});
