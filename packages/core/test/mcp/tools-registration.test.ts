import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentTools } from "../../src/domain/agent/logic/resolve-agent-tools.js";
import { AgentDefinitionValidator } from "../../src/domain/agent/logic/validate-agent-definition.js";
import type { AgentDefinition } from "../../src/domain/agent/model/agent-definition.js";
import { FileTools } from "../../src/domain/tool/builtin/vfs-tools.js";
import { BuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import type { McpConnectionManager } from "../../src/domain/mcp/ports/mcp-connection.port.js";
import type { McpToolSnapshot } from "../../src/domain/mcp/model/mcp-tool-snapshot.js";
import { ToolDefinitions } from "../../src/infra/llm-protocol/logic/tool-definitions.js";
import { Result } from "../../src/errors/either.js";
import { unwrap } from "../helpers/result-unwrap.js";

const BASE_DEF: AgentDefinition = {
    name: "test",
    prompts: { persist: [], dynamic: [] },
};

const mockToolCtx: BuiltinToolContext = {
    vfs: {} as never,
    projectId: "proj",
    sessionId: "sess",
    subagent: {
        agentRegistry: {} as never,
        messages: {} as never,
        sessions: {} as never,
        createChildSession: async () => "",
        runChildAgent: async () => ({} as never),
        resolveChildModelId: () => ({ savedModelId: "", workspaceModelId: "" }),
        depth: 0,
        parentSignal: new AbortController().signal,
        callableAgents: [{ name: "general" }],
    },
};

/** 注册测试不触达调用通道的 stub 管理器（callTool 恒失败，防误用静默通过）。 */
const stubManager = (): McpConnectionManager => ({cachedTools: () => [], serverTools: () => [], connectUnconnected: async () => {}, connect: async () => ({serverId: "stub", state: "pending"}), serverStatuses: () => [], callTool: async () => Result.err({kind: "protocol", action: "report", detail: "stub: 注册测试不应触达 callTool"}), invalidate: () => {}, closeAll: async () => {}});

/** 缓存条目工厂：本组用例只关心 serverId 与工具名。 */
const mcpSnapshot = (serverId: string, toolNames: readonly string[], toolDescription?: string): readonly McpToolSnapshot[] => toolNames.map((toolName) => ({ serverId, toolName, ...(toolDescription === undefined ? {} : {toolDescription}) }));

/** BuiltinTools.register（内置 12 件，含 mcp 占位）+ registerMcpTools 的公共装配。 */
const makeRegistry = (snapshot: readonly McpToolSnapshot[], manager: McpConnectionManager = stubManager()): ToolRegistry<BuiltinToolContext> => {
    const registry = new ToolRegistry<BuiltinToolContext>();
    BuiltinTools.register(registry);
    BuiltinTools.registerMcpTools(registry, snapshot, manager);
    return registry;
};

describe("BuiltinTools.registerMcpTools", () => {
    it("T-M20: 注册后 registry 含 mcp__<server>__<tool> 复合名，占位 mcp 被注销，自带工具原样保留", () => {
        const registry = new ToolRegistry<BuiltinToolContext>();
        BuiltinTools.register(registry);
        const builtinCount = registry.list().length;
        BuiltinTools.registerMcpTools(registry, mcpSnapshot("fs", ["read", "write"], "读一下"), stubManager());
        assert.ok(registry.get("mcp__fs__read") != null);
        assert.ok(registry.get("mcp__fs__write") != null);
        // 占位被无条件注销（有东西可替换时换掉，spec §D）。
        assert.ok(registry.get("mcp") == null);
        assert.equal(registry.list().length, builtinCount - 1 + 2);
        assert.ok(registry.get("read") != null);
        // description 同步取快照（tool-definitions 装配期同步求值的前提），不依赖 ctx IO。
        assert.equal(registry.get("mcp__fs__read")?.description(mockToolCtx), "[MCP:fs] 读一下");
    });

    it("T-M20: MCP 工具与内置工具同名也不 throw（mcp__ 前缀命名空间保证）", () => {
        const registry = makeRegistry(mcpSnapshot("srv", ["read"]));
        assert.ok(registry.get("read") != null);
        assert.ok(registry.get("mcp__srv__read") != null);
        assert.ok(registry.get("mcp") == null);
    });

    it("T-P5: BuiltinTools.register 后注册表为 12 个，占位 mcp 在册", () => {
        const registry = new ToolRegistry<BuiltinToolContext>();
        BuiltinTools.register(registry);
        assert.equal(registry.list().length, 12);
        assert.ok(registry.get("mcp") != null);
    });

    it("T-P7: 没有可替换的工具（空缓存）时占位同样被注销，无 mcp__ 工具，自带 11 件保留", () => {
        const registry = new ToolRegistry<BuiltinToolContext>();
        BuiltinTools.register(registry);
        BuiltinTools.registerMcpTools(registry, [], stubManager());
        assert.ok(registry.get("mcp") == null);
        assert.equal(registry.list().length, 11);
        assert.ok(registry.list().every((name) => !name.startsWith("mcp__")));
        assert.ok(registry.get("read") != null);
    });

    it("registerMcpTools 收到含重复名的工具列表时同名只注册第一个，不抛（T-C25c 的注册侧最后防线）", () => {
        const registry = new ToolRegistry<BuiltinToolContext>();
        BuiltinTools.register(registry);
        // 同一 server 声明两个归一后同名的工具（`.` 与 `-` 都归一成 `_`）。
        BuiltinTools.registerMcpTools(registry, mcpSnapshot("a", ["a.b", "a-b"]), stubManager());
        assert.ok(registry.get("mcp__a__a_b") != null);
        assert.equal(registry.list().filter((name) => name === "mcp__a__a_b").length, 1);
        assert.ok(registry.get("mcp") == null);
    });

    it("注册的工具 run 经 connectionManager.callTool 调用（serverId 闭包绑定、原始工具名透传）", async () => {
        const calls: { readonly serverId: string; readonly toolName: string; readonly args: unknown }[] = [];
        const manager: McpConnectionManager = { ...stubManager(), callTool: async (serverId, toolName, args) => {
            calls.push({ serverId, toolName, args });
            return Result.ok({ content: [{ type: "text", text: "pong" }], isError: false });
        } };
        const tool = makeRegistry(mcpSnapshot("fs", ["ping"]), manager).get("mcp__fs__ping");
        assert.ok(tool != null);
        const result = await tool.run({ x: 1 }, mockToolCtx);
        assert.ok(result.ok);
        assert.equal(result.value, "pong");
        assert.deepEqual(calls, [{ serverId: "fs", toolName: "ping", args: { x: 1 } }]);
    });

    it("工具结果是 JSON 时整理成多行返回，非 JSON 文本原样", async () => {
        const managerWith = (text: string): McpConnectionManager => ({ ...stubManager(), callTool: async () => Result.ok({ content: [{ type: "text", text }], isError: false }) });
        const json = makeRegistry(mcpSnapshot("kb", ["query"]), managerWith('{"hits":[{"id":1798274923044444160,"title":"a"}]}')).get("mcp__kb__query");
        const plain = makeRegistry(mcpSnapshot("kb", ["query"]), managerWith("第一行\n第二行 plain text")).get("mcp__kb__query");
        assert.ok(json != null && plain != null);
        const jsonResult = await json.run({}, mockToolCtx);
        const plainResult = await plain.run({}, mockToolCtx);
        assert.ok(jsonResult.ok && plainResult.ok);
        assert.equal(jsonResult.value, '{\n  "hits": [\n    {\n      "id": 1798274923044444160,\n      "title": "a"\n    }\n  ]\n}');
        assert.equal(plainResult.value, "第一行\n第二行 plain text");
    });
});

describe("占位替换语义（T-M21，spec §D）", () => {
    it("T-M21: 占位名 mcp 不被 policy 归一改写（普通词，normalizeAgentToolPolicyName 原样返回）", () => {
        assert.equal(FileTools.normalizeAgentToolPolicyName("mcp"), "mcp");
    });

    it("T-M21: 名单筛选含占位 mcp（allow 含 mcp）→ 替换后含 mcp__ 工具与 allow 内自带工具，不再含占位", () => {
        const base = new ToolRegistry<BuiltinToolContext>();
        BuiltinTools.register(base);
        const filtered = AgentTools.resolveRegistry(base, { ...BASE_DEF, tools: { allow: ["mcp", "read"] } });
        assert.ok(filtered.get("mcp") != null);
        BuiltinTools.registerMcpTools(filtered, mcpSnapshot("fs", ["read", "query"]), stubManager());
        assert.ok(filtered.get("mcp") == null);
        assert.ok(filtered.get("mcp__fs__query") != null);
        assert.ok(filtered.get("read") != null);
        assert.ok(filtered.get("write") == null);
    });

    it("T-M21: 名单筛掉占位 mcp（deny 含 mcp）→ 无占位、无任何 mcp__ 工具", () => {
        const base = new ToolRegistry<BuiltinToolContext>();
        BuiltinTools.register(base);
        const filtered = AgentTools.resolveRegistry(base, { ...BASE_DEF, tools: { deny: ["mcp"] } });
        assert.ok(filtered.get("mcp") == null);
        assert.ok(filtered.list().every((name) => !name.startsWith("mcp")));
        assert.ok(filtered.get("read") != null);
    });
});

describe("智能体策略「MCP」项（T-P 单元级；run 级装配在 test/service/agent/）", () => {
    /** register → resolveRegistry 的公共前缀。 */
    const resolve = (def: AgentDefinition): ToolRegistry<BuiltinToolContext> => {
        const base = new ToolRegistry<BuiltinToolContext>();
        BuiltinTools.register(base);
        return AgentTools.resolveRegistry(base, def);
    };

    it("T-P1: deny: [\"mcp\"] → 筛选结果不含 mcp，自带工具不受影响", () => {
        const filtered = resolve({ ...BASE_DEF, tools: { deny: ["mcp"] } });
        assert.ok(!filtered.list().includes("mcp"));
        assert.ok(filtered.get("read") != null);
        assert.ok(filtered.get("task") != null);
        assert.ok(filtered.get("search") != null);
    });

    it("T-P2: allow: [\"read\"] → 不含 mcp，也没有任何 mcp__ 工具", () => {
        const filtered = resolve({ ...BASE_DEF, tools: { allow: ["read"] } });
        assert.ok(!filtered.list().includes("mcp"));
        assert.ok(filtered.list().every((name) => !name.startsWith("mcp__")));
        assert.deepEqual(filtered.list(), ["read"]);
    });

    it("T-P3: allow: [\"mcp\", \"read\"] → 替换后含全部 mcp__ 工具与 read，不再含占位 mcp", () => {
        const filtered = resolve({ ...BASE_DEF, tools: { allow: ["mcp", "read"] } });
        BuiltinTools.registerMcpTools(filtered, mcpSnapshot("fs", ["read", "write"]), stubManager());
        assert.ok(filtered.get("mcp") == null);
        assert.ok(filtered.get("mcp__fs__read") != null);
        assert.ok(filtered.get("mcp__fs__write") != null);
        assert.ok(filtered.get("read") != null);
        assert.ok(filtered.get("task") == null);
    });

    it("T-P4: 无策略 → 替换后含全部工具（自带 11 + mcp__ 全部），不再含占位 mcp", () => {
        const filtered = resolve(BASE_DEF);
        assert.ok(filtered.get("mcp") != null);
        BuiltinTools.registerMcpTools(filtered, mcpSnapshot("fs", ["query"]), stubManager());
        assert.ok(filtered.get("mcp") == null);
        assert.ok(filtered.get("mcp__fs__query") != null);
        assert.ok(filtered.get("task") != null);
        assert.equal(filtered.list().length, 12);
    });

    it("T-P5: 保存校验对 mcp 通过：allow [\"mcp\", \"read\"] 与 deny [\"mcp\"] 都在 12 件已知名单内", async () => {
        const registry = new ToolRegistry<BuiltinToolContext>();
        BuiltinTools.register(registry);
        const allowOk = await AgentDefinitionValidator.validate({ ...BASE_DEF, tools: { allow: ["mcp", "read"] } }, {registeredToolNames: registry.list()});
        assert.ok(unwrap(allowOk) === undefined);
        const denyOk = await AgentDefinitionValidator.validate({ ...BASE_DEF, tools: { deny: ["mcp"] } }, {registeredToolNames: registry.list()});
        assert.ok(unwrap(denyOk) === undefined);
    });

    it("T-P6: 模型侧工具定义里从不出现名为 mcp 的占位工具（替换后的注册表）", () => {
        const registry = makeRegistry(mcpSnapshot("fs", ["query"]));
        const defs = ToolDefinitions.fromRegistry(registry, mockToolCtx);
        assert.ok(defs.length >= 12);
        assert.ok(defs.every((def) => def.name !== "mcp"));
        assert.ok(defs.some((def) => def.name === "mcp__fs__query"));
    });
});
