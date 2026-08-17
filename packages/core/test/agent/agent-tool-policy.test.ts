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

const mockToolCtx: BuiltinToolContext = {
  vfs: {} as never,
  projectId: "proj",
  sessionId: "sess",
  listSessionMessages: async () => [],
  subagent: {
    agentRegistry: {} as never,
    messages: {} as never,
    sessions: {} as never,
    createChildSession: async () => "",
    runChildAgent: async () => ({}) as never,
    resolveChildModelId: () => ({ savedModelId: "", workspaceModelId: "" }),
    depth: 0,
    parentSignal: new AbortController().signal,
    callableAgents: [{ name: "general" }],
  },
};

describe("agent tool policy", () => {
  const registryNames = new Set(vfsRegistryNames());

  it("T1: no tools config exposes all builtin tools", () => {
    const base = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(base);
    const filtered = resolveAgentToolRegistry(base, BASE_DEF);
    assert.deepEqual(filtered.list().sort(), vfsRegistryNames().sort());
    assert.equal(toolsFromRegistry(filtered, mockToolCtx).length, vfsRegistryNames().length);
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
    assert.equal(toolsFromRegistry(filtered, mockToolCtx).length, 2);
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
    assert.equal(toolsFromRegistry(filtered, mockToolCtx).length, 0);
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

  // T-SK7a：skill_opt 可配置（allow / deny 校验通过，deny 后运行时 registry 不含它）
  it("T-SK7a: skill_opt 在 allow / deny 名单中均校验通过", () => {
    // allow 名单含 skill_opt：校验通过
    validateAgentToolPolicy(
      { allow: ["skill_opt", "read"] },
      registryNames,
    );
    // deny 名单含 skill_opt：校验同样通过
    validateAgentToolPolicy(
      { deny: ["skill_opt"] },
      registryNames,
    );
    // 未知名 + skill_opt 仍报错（skill_opt 不是白名单里的例外）
    assert.throws(
      () => validateAgentToolPolicy({ allow: ["skill_opt", "vfs.nope"] }, registryNames),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "INVALID_TOOL_POLICY",
    );
  });

  it("T-SK7a: deny skill_opt 后运行时 resolve 产物不含 skill_opt（其余工具不受影响）", () => {
    const def: AgentDefinition = {
      ...BASE_DEF,
      tools: { deny: ["skill_opt"] },
    };
    const base = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(base);
    const filtered = resolveAgentToolRegistry(base, def);
    assert.ok(!filtered.list().includes("skill_opt"));
    assert.ok(filtered.list().includes("read"));
    assert.ok(filtered.list().includes("task"));
    assert.equal(filtered.list().length, vfsRegistryNames().length - 1);
    // LLM 侧定义也不暴露（toolsFromRegistry 只遍历 resolve 后的 registry）
    assert.ok(
      !toolsFromRegistry(filtered, mockToolCtx).some((t) => t.name === "skill_opt"),
    );
    // TODO(Step 10)：deny 后 skillsIndex 置空的 D4 联动在提示词预算侧验证；
    // `$` 引用不受影响（注入全文不依赖工具），属后续步骤验收。
  });

  it("T-SK7a: allow 仅 skill_opt 时 registry 只剩它", () => {
    const def: AgentDefinition = {
      ...BASE_DEF,
      tools: { allow: ["skill_opt"] },
    };
    const base = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(base);
    const filtered = resolveAgentToolRegistry(base, def);
    assert.deepEqual(filtered.list(), ["skill_opt"]);
  });
});
