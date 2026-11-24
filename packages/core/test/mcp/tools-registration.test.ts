import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentTools } from "../../src/domain/agent/logic/resolve-agent-tools.js";
import type { AgentDefinition } from "../../src/domain/agent/model/agent-definition.js";
import { FileTools } from "../../src/domain/tool/builtin/vfs-tools.js";
import { BuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import type { McpConnectionManager } from "../../src/domain/mcp/ports/mcp-connection.port.js";
import type { McpToolSnapshot } from "../../src/domain/mcp/model/mcp-tool-snapshot.js";
import { Result } from "../../src/errors/either.js";

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
const stubManager = (): McpConnectionManager => ({ snapshotTools: async () => [], serverStatuses: () => [], callTool: async () => Result.err({ kind: "protocol", action: "report", detail: "stub: 注册测试不应触达 callTool" }), invalidate: () => {}, closeAll: async () => {} });

/** 快照条目工厂：serverName 沿 serverId（slug 源是 serverId，展示名不影响本组用例）。 */
const mcpSnapshot = (serverId: string, toolNames: readonly string[], toolDescription?: string): readonly McpToolSnapshot[] => toolNames.map((toolName) => ({ serverId, serverName: serverId, toolName, ...(toolDescription === undefined ? {} : {toolDescription}) }));

/** BuiltinTools.register + registerMcpTools 的公共装配（内置 11 件 + 传入快照）。 */
const makeRegistry = (snapshot: readonly McpToolSnapshot[], manager: McpConnectionManager = stubManager()): ToolRegistry<BuiltinToolContext> => {
    const registry = new ToolRegistry<BuiltinToolContext>();
    BuiltinTools.register(registry);
    BuiltinTools.registerMcpTools(registry, snapshot, manager);
    return registry;
};

describe("BuiltinTools.registerMcpTools", () => {
    it("T-M20: 注册后 registry 含 mcp__<server>__<tool> 复合名，内置工具原样保留", () => {
        const registry = new ToolRegistry<BuiltinToolContext>();
        BuiltinTools.register(registry);
        const builtinCount = registry.list().length;
        BuiltinTools.registerMcpTools(registry, mcpSnapshot("fs", ["read", "write"], "读一下"), stubManager());
        assert.ok(registry.get("mcp__fs__read") != null);
        assert.ok(registry.get("mcp__fs__write") != null);
        assert.equal(registry.list().length, builtinCount + 2);
        assert.ok(registry.get("read") != null);
        // description 同步取快照（tool-definitions 装配期同步求值的前提），不依赖 ctx IO。
        assert.equal(registry.get("mcp__fs__read")?.description(mockToolCtx), "[MCP:fs] 读一下");
    });

    it("T-M20: MCP 工具与内置工具同名也不 throw（mcp__ 前缀命名空间保证）", () => {
        const registry = makeRegistry(mcpSnapshot("srv", ["read"]));
        assert.ok(registry.get("read") != null);
        assert.ok(registry.get("mcp__srv__read") != null);
    });

    it("T-M20: 同一快照内 slug 重名时涉事 server 全部工具不注册且不 throw，其余 server 照常", () => {
        const registry = makeRegistry([...mcpSnapshot("dup", ["read", "read", "list"]), ...mcpSnapshot("ok", ["query"])]);
        assert.equal(registry.get("mcp__dup__read"), undefined);
        assert.equal(registry.get("mcp__dup__list"), undefined);
        assert.ok(registry.get("mcp__ok__query") != null);
    });

    it("T-M20: server id 归一后撞名（a.b 与 a_b → a_b）时两个涉事 server 都不注册且不 throw", () => {
        const registry = makeRegistry([...mcpSnapshot("a.b", ["read"]), ...mcpSnapshot("a_b", ["read", "write"])]);
        assert.equal(registry.get("mcp__a_b__read"), undefined);
        assert.equal(registry.get("mcp__a_b__write"), undefined);
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
});

describe("mcp__ 复合名的 policy 归一（T-M21）", () => {
    it("T-M21: normalizeAgentToolPolicyName 对 mcp__ 复合名原样返回（只剥 legacy vfs. 前缀）", () => {
        assert.equal(FileTools.normalizeAgentToolPolicyName("mcp__fs__read"), "mcp__fs__read");
        assert.equal(FileTools.normalizeAgentToolPolicyName("mcp__a_b__read"), "mcp__a_b__read");
    });

    it("T-M21: resolveRegistry 的 allow 名单里 mcp__ 名不被归一改写，对应工具保留", () => {
        const resolved = AgentTools.resolveRegistry(makeRegistry(mcpSnapshot("fs", ["read"])), { ...BASE_DEF, tools: { allow: ["mcp__fs__read"] } });
        assert.deepEqual(resolved.list(), ["mcp__fs__read"]);
    });

    it("T-M21: deny 名单里的 mcp__ 名精确摘除对应工具，不影响内置同名工具", () => {
        const resolved = AgentTools.resolveRegistry(makeRegistry(mcpSnapshot("fs", ["read"])), { ...BASE_DEF, tools: { deny: ["mcp__fs__read"] } });
        assert.ok(!resolved.list().includes("mcp__fs__read"));
        assert.ok(resolved.list().includes("read"));
    });
});
