import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { registerBuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import {
  AGENT_TOOL_NAME,
  agentTool,
} from "../../src/domain/tool/builtin/agent-tool.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import type { AgentRegistryService } from "../../src/service/agent/agent-registry.port.js";
import type { ValidateAgentDefinitionOptions } from "../../src/domain/agent/logic/validate-agent-definition.js";
import type { AgentDefinition } from "../../src/domain/agent/model/agent-definition.js";
import { AgentConfigError } from "../../src/errors/agent-config-errors.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import { assembleAgentsToolContext } from "../../src/service/agent/logic/run-agent-turn.js";
import { resolveAgentToolRegistry } from "../../src/domain/agent/logic/resolve-agent-tool-registry.js";

/** 最小合法 AgentDefinition 形状（照 agent-tool-policy.test.ts 的 BASE_DEF）。 */
function def(name: string, extra?: Partial<AgentDefinition>): AgentDefinition {
  return { name, prompts: { persist: [], dynamic: [] }, ...extra };
}

const GENERAL_DEF = def("general", { description: "内置通用 agent" });

/**
 * 构造 fake AgentRegistryService：持久化行存 Map（wire 与解码后定义同源），
 * 按调用记录断言；upsert 可注入抛错场景（T-AG3）。
 */
function fakeAgentRegistry(options?: {
  /** registry.list() 的返回（含虚拟 seed general，照真实语义）。 */
  readonly list?: readonly AgentDefinition[];
  /** upsert 抛错场景（模拟服务层校验失败）。 */
  readonly upsertThrows?: (agentId: string) => Error;
}): AgentRegistryService & {
  readonly calls: { readonly method: string; readonly args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const record = <A extends unknown[], R>(
    method: string,
    fn: (...args: A) => R,
  ) => {
    return (...args: A): R => {
      calls.push({ method, args });
      return fn(...args);
    };
  };

  const persisted = new Map<string, AgentDefinition>();
  // 预置一个持久化 agent（beta），供 by-name / by-agentId 定位用。
  persisted.set("agent-1", def("beta"));

  const service: AgentRegistryService = {
    listAgentIds: record("listAgentIds", async () => [...persisted.keys()]),
    list: record(
      "list",
      async () => options?.list ?? [GENERAL_DEF, ...persisted.values()],
    ),
    getRawWire: record("getRawWire", async (id: string) =>
      persisted.has(id) ? { ...persisted.get(id) } : null,
    ),
    get: record("get", async (id: string) => {
      const found = persisted.get(id);
      if (found == null) throw new AgentConfigError("AGENT_NOT_FOUND", `未找到 ${id}`);
      return found;
    }),
    upsert: record(
      "upsert",
      async (
        id: string,
        definition: AgentDefinition,
        _options?: ValidateAgentDefinitionOptions,
      ) => {
        if (options?.upsertThrows != null) throw options.upsertThrows(id);
        persisted.set(id, definition);
      },
    ),
    delete: record("delete", async (id: string) => {
      persisted.delete(id);
    }),
  };
  return { ...service, calls } as ReturnType<typeof fakeAgentRegistry>;
}

/** 构造带 agents 闭包的工具上下文（照装配点注入形态）。 */
function makeCtx(
  registry: AgentRegistryService,
  agents: readonly { name: string; description?: string; mode?: "primary" | "subagent" | "all" }[] = [
    { name: "general", description: "内置通用 agent", mode: "all" },
    { name: "beta", mode: "subagent" },
  ],
): BuiltinToolContext {
  return {
    vfs: {} as never,
    projectId: "proj-1",
    sessionId: "sess-1",
    listSessionMessages: async () => [],
    agents: {
      registry,
      agents: agents.map((a) => ({
        name: a.name,
        ...(a.description != null ? { description: a.description } : {}),
        mode: a.mode ?? "all",
      })),
      registeredToolNames: [
        "task", "read", "write", "edit", "fs", "glob", "grep", "skill", "agent",
      ],
    },
  };
}

function makeRunner(): ToolRunner<BuiltinToolContext> {
  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  return new ToolRunner(registry);
}

describe("agent 管理工具", () => {
  it("registerBuiltinTools 注册 agent（共 10 个内置工具）", () => {
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    assert.ok(registry.list().includes(AGENT_TOOL_NAME));
    assert.equal(registry.list().length, 10);
  });

  it("description lambda 从装配期快照拼名单（未装配 agents 时降级为空名单）", () => {
    const withAgents = agentTool.description(
      makeCtx(fakeAgentRegistry()),
    ) as string;
    assert.match(withAgents, /- general（mode: all）/);
    assert.match(withAgents, /- beta（mode: subagent）/);
    assert.match(withAgents, /list \/ get \/ create \/ update/);

    const bare: BuiltinToolContext = {
      vfs: {} as never,
      projectId: "p",
      sessionId: "s",
      listSessionMessages: async () => [],
    };
    const withoutAgents = agentTool.description(bare) as string;
    assert.match(withoutAgents, /（暂无）|当前可管理 agent 名单/);
  });

  it("description 瘦身契约：含 skill load agent-config 指路，无参数说明段，非名单正文有长度上限（T-AS3）", () => {
    const bare: BuiltinToolContext = {
      vfs: {} as never,
      projectId: "p",
      sessionId: "s",
      listSessionMessages: async () => [],
    };
    const desc = agentTool.description(bare) as string;
    // 指路句（空名单场景下也必须携带——字段细节已全部迁入内置技能）
    assert.match(desc, /skill load agent-config/);
    // 被删段落不残留：参数说明段与 definition 字段清单关键词
    assert.ok(!desc.includes("参数说明"));
    assert.ok(!/savedModelId|skillsPrefix|workplace|doomLoop/.test(desc));
    // 非名单正文长度上限（PRD：不含名单 ≤ 200 字，汉字口径约 150；
    // 此处按字符口径设上限，含英文 / 标点，空名单场景全文即非名单正文）
    assert.ok(
      desc.length <= 380,
      `非名单正文过长：${desc.length} 字符`,
    );
  });

  // T-AG1：action 分派与字段校验——缺必填报 INVALID_ARGUMENT 且错误信息含字段名。
  it("T-AG1：get 缺 name 与 agentId 报 INVALID_ARGUMENT 且文案含字段名", async () => {
    const runner = makeRunner();
    await assert.rejects(
      () => runner.call("agent", { action: "get" }, makeCtx(fakeAgentRegistry())),
      (e: unknown) =>
        e instanceof ToolError &&
        e.code === "INVALID_ARGUMENT" &&
        e.message.includes("name") &&
        e.message.includes("agentId"),
    );
  });

  it("T-AG1：create 缺 definition 报 INVALID_ARGUMENT 且文案含字段名", async () => {
    const runner = makeRunner();
    await assert.rejects(
      () => runner.call("agent", { action: "create" }, makeCtx(fakeAgentRegistry())),
      (e: unknown) =>
        e instanceof ToolError &&
        e.code === "INVALID_ARGUMENT" &&
        e.message.includes("definition"),
    );
  });

  it("T-AG1：update 缺定位字段（name/agentId 均空）报 INVALID_ARGUMENT", async () => {
    const runner = makeRunner();
    await assert.rejects(
      () =>
        runner.call(
          "agent",
          { action: "update", definition: { name: "beta" } },
          makeCtx(fakeAgentRegistry()),
        ),
      (e: unknown) =>
        e instanceof ToolError &&
        e.code === "INVALID_ARGUMENT" &&
        e.message.includes("name") &&
        e.message.includes("agentId"),
    );
  });

  it("闭包未注入（ctx.agents 缺失）时 run 报 FAILED", async () => {
    const runner = makeRunner();
    const bare: BuiltinToolContext = {
      vfs: {} as never,
      projectId: "p",
      sessionId: "s",
      listSessionMessages: async () => [],
    };
    await assert.rejects(
      () => runner.call("agent", { action: "list" }, bare),
      (e: unknown) =>
        e instanceof ToolError && e.code === "FAILED" && e.message.includes("agents"),
    );
  });

  // T-AG2：list 含虚拟 general；get by-name 命中 general、by-agentId 走 registry.get。
  it("T-AG2：list 从装配期快照直出，含虚拟 general（name/描述/mode）", async () => {
    const runner = makeRunner();
    const out = await runner.call<{
      action: "list";
      entries: { name: string; description?: string; mode: string }[];
      total: number;
    }>("agent", { action: "list" }, makeCtx(fakeAgentRegistry()));

    assert.equal(out.action, "list");
    assert.equal(out.total, 2);
    assert.deepEqual(
      out.entries.map((e) => e.name),
      ["general", "beta"],
    );
    assert.equal(out.entries[0].description, "内置通用 agent");
    assert.equal(out.entries[0].mode, "all");
  });

  it("T-AG2：get by-name 命中虚拟 general（走 registry.list，无 agentId 回填）", async () => {
    const registry = fakeAgentRegistry();
    const runner = makeRunner();
    const out = await runner.call<{
      action: "get";
      agentId?: string;
      definition: AgentDefinition;
    }>("agent", { action: "get", name: "general" }, makeCtx(registry));

    assert.equal(out.action, "get");
    assert.equal(out.definition.name, "general");
    assert.equal(out.agentId, undefined);
    // by-name 走 list()（合并虚拟 seed），不走 get(id)
    assert.ok(registry.calls.some((c) => c.method === "list"));
    assert.ok(!registry.calls.some((c) => c.method === "get"));
  });

  it("T-AG2：get by-agentId 走 getRawWire 判存在 + registry.get 解码", async () => {
    const registry = fakeAgentRegistry();
    const runner = makeRunner();
    const out = await runner.call<{
      action: "get";
      agentId?: string;
      definition: AgentDefinition;
    }>("agent", { action: "get", agentId: "agent-1" }, makeCtx(registry));

    assert.equal(out.agentId, "agent-1");
    assert.equal(out.definition.name, "beta");
    assert.ok(registry.calls.some((c) => c.method === "getRawWire"));
    assert.ok(registry.calls.some((c) => c.method === "get"));
  });

  it("T-AG2：get by-name 输入侧 trim——带空白的名字仍可命中（D-4）", async () => {
    const registry = fakeAgentRegistry();
    const runner = makeRunner();
    const out = await runner.call<{
      action: "get";
      definition: AgentDefinition;
    }>("agent", { action: "get", name: "  beta  " }, makeCtx(registry));

    assert.equal(out.action, "get");
    assert.equal(out.definition.name, "beta");
  });

  it("T-AG2：get 未命中（by-name / by-agentId）报 FAILED 且文案含目标", async () => {
    const runner = makeRunner();
    const ctx = makeCtx(fakeAgentRegistry());
    await assert.rejects(
      () => runner.call("agent", { action: "get", name: "nope" }, ctx),
      (e: unknown) =>
        e instanceof ToolError && e.code === "FAILED" && e.message.includes("nope"),
    );
    await assert.rejects(
      () => runner.call("agent", { action: "get", agentId: "agent-404" }, ctx),
      (e: unknown) =>
        e instanceof ToolError &&
        e.code === "FAILED" &&
        e.message.includes("agent-404"),
    );
  });

  // T-AG3：create/update 经 upsert 校验——未注册工具名被拒、错误信息含原因。
  it("T-AG3：create 生成 agent- 前缀新 id 并经 upsert 落盘，输出含生效提示", async () => {
    const registry = fakeAgentRegistry();
    const runner = makeRunner();
    const out = await runner.call<{
      action: "create";
      name: string;
      agentId: string;
      message: string;
    }>(
      "agent",
      { action: "create", definition: { name: "gamma", mode: "subagent" } },
      makeCtx(registry),
    );

    assert.equal(out.action, "create");
    assert.equal(out.name, "gamma");
    assert.ok(out.agentId.startsWith("agent-"));
    assert.match(out.message, /下一次会话生效/);
    const upsert = registry.calls.find((c) => c.method === "upsert");
    assert.ok(upsert);
    assert.equal(upsert.args[0], out.agentId);
  });

  it("T-AG3：upsert 抛 AgentConfigError（未注册工具名）→ INVALID_ARGUMENT 且含原因", async () => {
    const registry = fakeAgentRegistry({
      upsertThrows: () =>
        new AgentConfigError(
          "INVALID_TOOL_POLICY",
          "工具策略含未注册工具名：nope_tool",
        ),
    });
    const runner = makeRunner();
    await assert.rejects(
      () =>
        runner.call(
          "agent",
          { action: "create", definition: { name: "gamma", tools: { allow: ["nope_tool"] } } },
          makeCtx(registry),
        ),
      (e: unknown) =>
        e instanceof ToolError &&
        e.code === "INVALID_ARGUMENT" &&
        e.message.includes("未注册工具名") &&
        e.message.includes("nope_tool"),
    );
  });

  it("T-AG3：upsert 抛普通 Error → FAILED 且 message 透传原因", async () => {
    const registry = fakeAgentRegistry({
      upsertThrows: () => new Error("数据库只读"),
    });
    const runner = makeRunner();
    await assert.rejects(
      () =>
        runner.call(
          "agent",
          { action: "create", definition: { name: "gamma" } },
          makeCtx(registry),
        ),
      (e: unknown) =>
        e instanceof ToolError &&
        e.code === "FAILED" &&
        e.message.includes("数据库只读"),
    );
  });

  it("T-AG3：update by-name 经 getRawWire 解析持久化 id 后整体覆盖", async () => {
    const registry = fakeAgentRegistry();
    const runner = makeRunner();
    const out = await runner.call<{
      action: "update";
      name: string;
      agentId: string;
    }>(
      "agent",
      { action: "update", name: "beta", definition: { name: "beta", description: "改" } },
      makeCtx(registry),
    );

    assert.equal(out.action, "update");
    assert.equal(out.agentId, "agent-1");
    const upsert = registry.calls.find((c) => c.method === "upsert");
    assert.ok(upsert);
    assert.equal(upsert.args[0], "agent-1");
    assert.deepEqual(upsert.args[1], { name: "beta", description: "改" });
  });

  it("T-AG3：update by-name 命中虚拟 general（无持久化 id）报「内置 agent 不支持修改」", async () => {
    const runner = makeRunner();
    await assert.rejects(
      () =>
        runner.call(
          "agent",
          { action: "update", name: "general", definition: { name: "general" } },
          makeCtx(fakeAgentRegistry()),
        ),
      (e: unknown) =>
        e instanceof ToolError &&
        e.code === "FAILED" &&
        e.message.includes("内置 agent"),
    );
  });

  it("T-AG3：update by-agentId 先 getRawWire 判存在再直达持久化行（B-nit1）", async () => {
    const registry = fakeAgentRegistry();
    const runner = makeRunner();
    const out = await runner.call<{ action: "update"; agentId: string }>(
      "agent",
      { action: "update", agentId: "agent-1", definition: { name: "beta2" } },
      makeCtx(registry),
    );
    assert.equal(out.agentId, "agent-1");
    // 存在性检查先行，随后 upsert 覆盖同一持久化行。
    assert.ok(registry.calls.some((c) => c.method === "getRawWire"));
    const upsert = registry.calls.find((c) => c.method === "upsert");
    assert.ok(upsert);
    assert.equal(upsert.args[0], "agent-1");
  });

  it("T-AG3：update by-agentId 过期 id 报 INVALID_ARGUMENT 且不静默新建（B-nit1）", async () => {
    const registry = fakeAgentRegistry();
    const runner = makeRunner();
    await assert.rejects(
      () =>
        runner.call(
          "agent",
          { action: "update", agentId: "agent-404", definition: { name: "ghost" } },
          makeCtx(registry),
        ),
      (e: unknown) =>
        e instanceof ToolError &&
        e.code === "INVALID_ARGUMENT" &&
        e.message.includes("agent-404") &&
        e.message.includes("未找到"),
    );
    // 过期 id 不应被 upsert 静默新建成新行。
    assert.ok(!registry.calls.some((c) => c.method === "upsert"));
  });
});

describe("assembleAgentsToolContext 装配（run-agent-turn 两态）", () => {
  it("注册表含 agent 时注入闭包：agents 快照映射 + registeredToolNames 透传", () => {
    const agentRegistry = fakeAgentRegistry();
    const probe = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(probe);
    const allDefs: AgentDefinition[] = [
      GENERAL_DEF,
      def("beta", { mode: "subagent" }),
    ];

    const ctx = assembleAgentsToolContext(
      agentRegistry,
      allDefs,
      probe.list(),
      probe,
    );

    assert.ok(ctx, "主装配点（registry 含 agent）应注入闭包");
    assert.equal(ctx.registry, agentRegistry);
    // mode 缺省按 "all" 解释（与 AgentDefinition 消费侧 fallback 一致）
    assert.deepEqual(ctx.agents, [
      { name: "general", description: "内置通用 agent", mode: "all" },
      { name: "beta", mode: "subagent" },
    ]);
    assert.deepEqual(ctx.registeredToolNames, probe.list());
  });

  it("注册表不含 agent（子/孙摘除 D6 或 deny）时返回 undefined（闭包不注入）", () => {
    const probe = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(probe);

    // 摘除路径 1：mode === "subagent"
    const subRegistry = resolveAgentToolRegistry(
      probe,
      def("child", { mode: "subagent" }),
    );
    assert.ok(!subRegistry.list().includes("agent"));
    assert.equal(
      assembleAgentsToolContext(
        fakeAgentRegistry(),
        [],
        probe.list(),
        subRegistry,
      ),
      undefined,
    );

    // 摘除路径 2：depth >= 2（孙 agent）
    const grandRegistry = resolveAgentToolRegistry(probe, def("grand"), {
      depth: 2,
    });
    assert.ok(!grandRegistry.list().includes("agent"));
    assert.equal(
      assembleAgentsToolContext(
        fakeAgentRegistry(),
        [],
        probe.list(),
        grandRegistry,
      ),
      undefined,
    );

    // 摘除路径 3：用户 policy 显式 deny agent
    const deniedRegistry = resolveAgentToolRegistry(
      probe,
      def("main", { tools: { deny: ["agent"] } }),
    );
    assert.ok(!deniedRegistry.list().includes("agent"));
    assert.equal(
      assembleAgentsToolContext(
        fakeAgentRegistry(),
        [],
        probe.list(),
        deniedRegistry,
      ),
      undefined,
    );
  });
});
