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

  // T-SK7a：skill 可配置（allow / deny 校验通过，deny 后运行时 registry 不含它）
  it("T-SK7a: skill 在 allow / deny 名单中均校验通过", () => {
    // allow 名单含 skill：校验通过
    validateAgentToolPolicy(
      { allow: ["skill", "read"] },
      registryNames,
    );
    // deny 名单含 skill：校验同样通过
    validateAgentToolPolicy(
      { deny: ["skill"] },
      registryNames,
    );
    // 未知名 + skill 仍报错（skill 不是白名单里的例外）
    assert.throws(
      () => validateAgentToolPolicy({ allow: ["skill", "vfs.nope"] }, registryNames),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "INVALID_TOOL_POLICY",
    );
  });

  it("T-SK7a: deny skill 后运行时 resolve 产物不含 skill（其余工具不受影响）", () => {
    const def: AgentDefinition = {
      ...BASE_DEF,
      tools: { deny: ["skill"] },
    };
    const base = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(base);
    const filtered = resolveAgentToolRegistry(base, def);
    assert.ok(!filtered.list().includes("skill"));
    assert.ok(filtered.list().includes("read"));
    assert.ok(filtered.list().includes("task"));
    assert.equal(filtered.list().length, vfsRegistryNames().length - 1);
    // LLM 侧定义也不暴露（toolsFromRegistry 只遍历 resolve 后的 registry）
    assert.ok(
      !toolsFromRegistry(filtered, mockToolCtx).some((t) => t.name === "skill"),
    );
    // TODO(Step 10)：deny 后 skillsIndex 置空的 D4 联动在提示词预算侧验证；
    // `$` 引用不受影响（注入全文不依赖工具），属后续步骤验收。
  });

  // T-SK13：技能能力总开关（prompts.skillsEnabled）
  it("T-SK13: skillsEnabled=false 强制移除 skill 工具（即便 allow 名单含它）；缺省/true 保留", () => {
    const def: AgentDefinition = {
      ...BASE_DEF,
      prompts: {...BASE_DEF.prompts, skillsEnabled: false},
      tools: { allow: ["skill", "read"] },
    };
    const base = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(base);
    const filtered = resolveAgentToolRegistry(base, def);
    assert.ok(!filtered.list().includes("skill"));
    assert.ok(filtered.list().includes("read"));

    // 缺省（字段未写）与显式 true 均保留
    const defDefault: AgentDefinition = { ...BASE_DEF, tools: { allow: ["skill"] } };
    assert.ok(
      resolveAgentToolRegistry(base, defDefault).list().includes("skill"),
    );
    const defOn: AgentDefinition = {
      ...BASE_DEF,
      prompts: { ...BASE_DEF.prompts, skillsEnabled: true },
      tools: { allow: ["skill"] },
    };
    assert.ok(resolveAgentToolRegistry(base, defOn).list().includes("skill"));
  });

  it("T-SK7a: allow 仅 skill 时 registry 只剩它", () => {
    const def: AgentDefinition = {
      ...BASE_DEF,
      tools: { allow: ["skill"] },
    };
    const base = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(base);
    const filtered = resolveAgentToolRegistry(base, def);
    assert.deepEqual(filtered.list(), ["skill"]);
  });

  // T-AG4：agent 管理工具的摘除与策略路径（对应 PRD 验收 7）
  it("T-AG4: mode 为 subagent 或 depth>=2 的注册表不含 agent（与 task 同分支摘除）", () => {
    const base = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(base);

    // 子 agent（mode === "subagent"）：task / agent 均强制移除
    const subDef: AgentDefinition = { ...BASE_DEF, mode: "subagent" };
    const sub = resolveAgentToolRegistry(base, subDef);
    assert.ok(!sub.list().includes("agent"));
    assert.ok(!sub.list().includes("task"));
    assert.ok(sub.list().includes("read"));
    // LLM 侧定义也不暴露（toolsFromRegistry 只遍历 resolve 后的 registry）
    assert.ok(
      !toolsFromRegistry(sub, mockToolCtx).some((t) => t.name === "agent"),
    );

    // 孙 agent（depth >= 2，递归上限双保险）：即使 allow 显式含 agent 也移除
    const grandDef: AgentDefinition = {
      ...BASE_DEF,
      tools: { allow: ["agent", "read"] },
    };
    const grand = resolveAgentToolRegistry(base, grandDef, { depth: 2 });
    assert.ok(!grand.list().includes("agent"));
    assert.ok(!grand.list().includes("task"));
    assert.ok(grand.list().includes("read"));

    // 主 agent（depth=0、非 subagent）保留 agent
    const main = resolveAgentToolRegistry(base, BASE_DEF);
    assert.ok(main.list().includes("agent"));
  });

  it("T-AG4: deny 含 agent → 摘除；allow 显式含 agent → 保留（主 agent 策略路径）", () => {
    const base = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(base);

    // deny 名单校验通过（agent 是合法策略名）
    validateAgentToolPolicy({ deny: ["agent"] }, registryNames);
    const denied = resolveAgentToolRegistry(
      base,
      { ...BASE_DEF, tools: { deny: ["agent"] } },
    );
    assert.ok(!denied.list().includes("agent"));
    assert.equal(denied.list().length, vfsRegistryNames().length - 1);

    // allow 名单校验通过，且主 agent 显式 allow 含 agent 时保留
    validateAgentToolPolicy({ allow: ["agent", "read"] }, registryNames);
    const allowed = resolveAgentToolRegistry(
      base,
      { ...BASE_DEF, tools: { allow: ["agent", "read"] } },
    );
    assert.deepEqual(allowed.list().sort(), ["agent", "read"]);
  });
});
