/**
 * MCP 配置 handler 单测（CR-02 / CR-03 / CR-08）：不拉真实 runtime——loader hook
 * （mcp-handlers-mock-hook.mjs）把 desktop-runtime-singleton 重定向到内存 mock
 * （mcp-handlers-mock-runtime.ts：密钥表 / 配置表 / agent 注册表 / 连接管理器全可断言），
 * 聚焦 saveServer 的编排与回滚顺序（bearer 写入时机、换 ID 回滚）与每工具启停的读写。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, it } from "node:test";
import type { McpServerConfig, McpToolSnapshot } from "@novel-master/core/mcp";
import { makeAgentRegistry, makeConnectionManager, makeRuntime, makeSecretStore, runtimeHolder, type MockAgentRegistry, type MockConnectionManager, type MockRuntime, type MockSecretStore } from "./mcp-handlers-mock-runtime.js";

// 必须在动态 import handler 之前注册 hook，否则真实单例已加载、mock 不生效。
register(new URL("./mcp-handlers-mock-hook.mjs", import.meta.url), import.meta.url);

const { Mcp } = await import("../src/main/ipc/handlers/mcp.js");

/** bearer 鉴权的 http server 配置（handler 归一后的存储形态；明文只在 SKSP，配置只带 ref）。 */
function bearerServer(id: string): McpServerConfig {
    return { id, description: "", enabled: true, transport: { type: "http", url: `http://${id}.example.com/mcp` }, timeoutMs: 120_000, auth: { type: "bearer", secretRef: `mcp/${id}/bearer` } };
}

/** agent 定义窄形状（mock 注册表只消费 tools 名单）。 */
function agentWithAllow(allow: readonly string[]): { name: string; prompts: { persist: string[]; dynamic: string[] }; tools: { allow: readonly string[] } } {
    return { name: "writer", prompts: { persist: [], dynamic: [] }, tools: { allow } };
}

/** 装配 runtime + 换 ID 场景（旧 server + 带 mcp__<id>__ 名单的 agent），返回各 mock 便于断言。 */
function setupRename(oldToken: string | null): { runtime: MockRuntime; secretStore: MockSecretStore; agentRegistry: MockAgentRegistry; connectionManager: MockConnectionManager } {
    const initial: Record<string, string> = oldToken == null ? {} : { "mcp/old/bearer": oldToken };
    const secretStore = makeSecretStore(initial);
    const agentRegistry = makeAgentRegistry();
    agentRegistry.seed("writer", agentWithAllow(["mcp__old__tool1", "read"]));
    const runtime = makeRuntime({ secretStore, servers: [bearerServer("old")], agentRegistry });
    const connectionManager = runtime.mcp.connectionManager;
    runtimeHolder.current = runtime;
    return { runtime, secretStore, agentRegistry, connectionManager };
}

describe("MCP saveServer 编排（mcp-support CR-02 / CR-03 / CR-08）", () => {
    it("T-MH1：create 撞名被拒时 SKSP 未被写入（已有同名 server 的密钥原样保留）", async () => {
        const secretStore = makeSecretStore({ "mcp/a/bearer": "existing-token" });
        runtimeHolder.current = makeRuntime({ secretStore, servers: [bearerServer("a")] });
        const res = await Mcp.saveServer({ id: "a", create: true, description: "", transportType: "http", url: "http://a.example.com/mcp", authType: "bearer", bearerToken: "sneaky-token" });
        assert.equal(res.ok, false, "撞名 create 应被拒绝");
        assert.equal(secretStore.calls.sets.length, 0, "SKSP set 不应发生（bearer 在 create 成功后才写）");
        assert.equal(secretStore.peek("mcp/a/bearer"), "existing-token", "已有 server 的密钥不被覆盖");
    });

    it("T-MH2：换 ID 成功——配置改名、agent 引用改写、旧密钥随迁且用户新填的 bearer 覆盖新 ref", async () => {
        const { runtime, secretStore, agentRegistry } = setupRename("old-token");
        const res = await Mcp.saveServer({ id: "new", previousId: "old", description: "新描述", transportType: "http", url: "http://new.example.com/mcp", authType: "bearer", bearerToken: "user-token" });
        assert.equal(res.ok, true);
        if (res.ok) assert.equal(res.data.serverId, "new");
        assert.deepEqual(runtime.mcpConfig.servers.map((server) => server.id), ["new"], "配置原位换名");
        assert.deepEqual(agentRegistry.agents.get("writer")?.tools?.allow, ["mcp__new__tool1", "read"], "agent 白名单前缀改写");
        assert.equal(secretStore.peek("mcp/new/bearer"), "user-token", "旧密钥随迁后用户新填值覆盖（搬家旧值不盖新输入）");
        assert.equal(secretStore.peek("mcp/old/bearer"), undefined, "旧 ref 清除");
    });

    it("T-MH3：agent 引用改写失败时回滚——配置与 agent 引用都回到旧 ID", async () => {
        const secretStore = makeSecretStore();
        const agentRegistry = makeAgentRegistry({ failUpsert: true });
        agentRegistry.seed("writer", agentWithAllow(["mcp__old__tool1"]));
        runtimeHolder.current = makeRuntime({ secretStore, servers: [bearerServer("old")], agentRegistry });
        const res = await Mcp.saveServer({ id: "new", previousId: "old", description: "", transportType: "http", url: "http://new.example.com/mcp", authType: "none" });
        assert.equal(res.ok, false, "改写失败应整体报错");
        assert.deepEqual(runtimeHolder.current?.mcpConfig.servers.map((server) => server.id), ["old"], "配置未改名");
        assert.equal(runtimeHolder.current?.mcpConfig.servers[0]?.description, "", "旧配置内容未被覆盖");
        assert.deepEqual(agentRegistry.agents.get("writer")?.tools?.allow, ["mcp__old__tool1"], "agent 引用保持旧前缀");
    });

    it("T-MH4：换 ID 时 bearer 写入失败回滚——配置与 agent 引用回到旧 ID，新 ref 不留半提交密钥", async () => {
        const { runtime, secretStore, agentRegistry } = setupRename(null);
        secretStore.armSetFailure(new Error("SKSP 写入失败"));
        const res = await Mcp.saveServer({ id: "new", previousId: "old", description: "", transportType: "http", url: "http://new.example.com/mcp", authType: "bearer", bearerToken: "user-token" });
        assert.equal(res.ok, false, "bearer 写入失败应整体报错");
        assert.deepEqual(runtime.mcpConfig.servers.map((server) => server.id), ["old"], "配置迁回旧 ID");
        assert.deepEqual(agentRegistry.agents.get("writer")?.tools?.allow, ["mcp__old__tool1", "read"], "agent 引用反向改写回旧前缀");
        assert.equal(secretStore.peek("mcp/new/bearer"), undefined, "新 ref 不留半提交密钥");
    });

    it("T-MH5：enabled 保存后调用 snapshotTools；enabled: false 时不调用", async () => {
        const runtime = makeRuntime({ servers: [bearerServer("a")] });
        runtimeHolder.current = runtime;
        const connectionManager = runtime.mcp.connectionManager;
        await Mcp.saveServer({ id: "a", description: "", transportType: "http", url: "http://a.example.com/mcp", authType: "none", enabled: true });
        assert.equal(connectionManager.calls.snapshot, 1, "启用保存触发自动连接");
        await Mcp.saveServer({ id: "a", description: "", transportType: "http", url: "http://a.example.com/mcp", authType: "none", enabled: false });
        assert.equal(connectionManager.calls.snapshot, 1, "停用保存不再触发连接");
    });
});

describe("MCP 每工具启停（mcp-support D4，与移动端对齐）", () => {
    it("T-MH6：toolList 按 server 过滤并从禁用表取 disabled；setToolDisabled 写后生效", async () => {
        const snapshot: readonly McpToolSnapshot[] = [
            { serverId: "a", toolName: "toolA", toolDescription: "第一个工具" },
            { serverId: "a", toolName: "toolB" },
            { serverId: "b", toolName: "other" },
        ];
        runtimeHolder.current = makeRuntime({ connectionManager: makeConnectionManager(snapshot) });
        const before = await Mcp.toolList({ serverId: "a" });
        assert.equal(before.ok, true);
        if (before.ok) {
            assert.deepEqual(before.data.map((row) => ({ toolName: row.toolName, disabled: row.disabled })), [
                { toolName: "toolA", disabled: false },
                { toolName: "toolB", disabled: false },
            ], "只含目标 server 的工具，初始全部启用");
            assert.equal(before.data[0]?.toolDescription, "第一个工具", "描述透传");
        }
        const written = await Mcp.setToolDisabled({ serverId: "a", toolName: "toolB", disabled: true });
        assert.equal(written.ok, true);
        const after = await Mcp.toolList({ serverId: "a" });
        assert.equal(after.ok, true);
        if (after.ok) {
            assert.deepEqual(after.data.map((row) => row.disabled), [false, true], "写入后 disabled 反映禁用表");
        }
    });
});
