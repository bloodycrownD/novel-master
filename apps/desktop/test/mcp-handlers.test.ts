/**
 * MCP 配置 handler 单测（mcp-connect-model T-D 组为主）：不拉真实 runtime——loader hook
 * （mcp-handlers-mock-hook.mjs）把 desktop-runtime-singleton 重定向到内存 mock
 * （mcp-handlers-mock-runtime.ts：密钥表 / 配置表 / agent 注册表 / 连接管理器全可断言），
 * 聚焦 saveServer 的编排与回滚顺序（bearer 写入时机、换 ID 回滚）、进页连接与测试连接
 * 的接线（connect / connectUnconnected）、toolList 只读缓存，以及 OAuth 授权成功后的
 * 作废重连；每工具启停的读写保留回归覆盖。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, it } from "node:test";
import type { McpServerConfig, McpServerStatus, McpToolSnapshot } from "@novel-master/core/mcp";
import { Result } from "@novel-master/core/errors";
import { makeConnectionManager, makeRuntime, makeSecretStore, runtimeHolder, type MockConnectionManager, type MockRuntime, type MockSecretStore } from "./mcp-handlers-mock-runtime.js";

// 必须在动态 import handler 之前注册 hook，否则真实单例已加载、mock 不生效。
register(new URL("./mcp-handlers-mock-hook.mjs", import.meta.url), import.meta.url);

const { Mcp } = await import("../src/main/ipc/handlers/mcp.js");

/** bearer 鉴权的 http server 配置（handler 归一后的存储形态；明文只在 SKSP，配置只带 ref）。 */
function bearerServer(id: string): McpServerConfig {
    return { id, description: "", enabled: true, transport: { type: "http", url: `http://${id}.example.com/mcp` }, timeoutMs: 120_000, auth: { type: "bearer", secretRef: `mcp/${id}/bearer` } };
}

/** 装配 runtime + 换 ID 场景（旧 server + 旧密钥），返回各 mock 便于断言。 */
function setupRename(oldToken: string | null): { runtime: MockRuntime; secretStore: MockSecretStore; connectionManager: MockConnectionManager } {
    const initial: Record<string, string> = oldToken == null ? {} : { "mcp/old/bearer": oldToken };
    const secretStore = makeSecretStore(initial);
    const runtime = makeRuntime({ secretStore, servers: [bearerServer("old")] });
    runtimeHolder.current = runtime;
    return { runtime, secretStore, connectionManager: runtime.mcp.connectionManager };
}

describe("MCP saveServer 编排（T-MH1 / T-D2 / T-D6 / 换 ID 回滚）", () => {
    it("T-MH1：create 撞名被拒时 SKSP 未被写入（已有同名 server 的密钥原样保留）", async () => {
        const secretStore = makeSecretStore({ "mcp/a/bearer": "existing-token" });
        runtimeHolder.current = makeRuntime({ secretStore, servers: [bearerServer("a")] });
        const res = await Mcp.saveServer({ id: "a", create: true, description: "", transportType: "http", url: "http://a.example.com/mcp", authType: "bearer", bearerToken: "sneaky-token" });
        assert.equal(res.ok, false, "撞名 create 应被拒绝");
        assert.equal(secretStore.calls.sets.length, 0, "SKSP set 不应发生（bearer 在 create 成功后才写）");
        assert.equal(secretStore.peek("mcp/a/bearer"), "existing-token", "已有 server 的密钥不被覆盖");
    });

    it("T-MH2：换 ID 成功——配置改名、旧密钥随迁且用户新填的 bearer 覆盖新 ref", async () => {
        const { runtime, secretStore } = setupRename("old-token");
        const res = await Mcp.saveServer({ id: "new", previousId: "old", description: "新描述", transportType: "http", url: "http://new.example.com/mcp", authType: "bearer", bearerToken: "user-token" });
        assert.equal(res.ok, true);
        if (res.ok) assert.equal(res.data.serverId, "new");
        assert.deepEqual(runtime.mcpConfig.servers.map((server) => server.id), ["new"], "配置原位换名");
        assert.equal(secretStore.peek("mcp/new/bearer"), "user-token", "旧密钥随迁后用户新填值覆盖（搬家旧值不盖新输入）");
        assert.equal(secretStore.peek("mcp/old/bearer"), undefined, "旧 ref 清除");
    });

    it("T-MH3：rename 失败（新 ID 撞已有 server）时不写 bearer、配置不动", async () => {
        const secretStore = makeSecretStore();
        runtimeHolder.current = makeRuntime({ secretStore, servers: [bearerServer("old"), bearerServer("taken")] });
        const res = await Mcp.saveServer({ id: "taken", previousId: "old", description: "", transportType: "http", url: "http://taken.example.com/mcp", authType: "bearer", bearerToken: "user-token" });
        assert.equal(res.ok, false, "撞名 rename 应整体报错");
        assert.deepEqual(runtimeHolder.current?.mcpConfig.servers.map((server) => server.id), ["old", "taken"], "配置未动");
        assert.equal(secretStore.calls.sets.length, 0, "失败路径不写任何密钥");
    });

    it("T-MH4：换 ID 时 bearer 写入失败回滚——配置按旧配置改回旧 ID，新 ref 不留半提交密钥", async () => {
        const { runtime, secretStore } = setupRename(null);
        secretStore.armSetFailure(new Error("SKSP 写入失败"));
        const res = await Mcp.saveServer({ id: "new", previousId: "old", description: "", transportType: "http", url: "http://new.example.com/mcp", authType: "bearer", bearerToken: "user-token" });
        assert.equal(res.ok, false, "bearer 写入失败应整体报错");
        assert.deepEqual(runtime.mcpConfig.servers.map((server) => server.id), ["old"], "配置迁回旧 ID");
        assert.equal(runtime.mcpConfig.servers[0]?.id, "old", "旧配置内容未被覆盖");
        assert.equal(secretStore.peek("mcp/new/bearer"), undefined, "新 ref 不留半提交密钥");
    });

    it("T-D2：saveServer 启用时调 connect，停用时不调（替换 T-MH5）", async () => {
        const runtime = makeRuntime({ servers: [bearerServer("a")] });
        runtimeHolder.current = runtime;
        const connectionManager = runtime.mcp.connectionManager;
        await Mcp.saveServer({ id: "a", description: "", transportType: "http", url: "http://a.example.com/mcp", authType: "none", enabled: true });
        assert.deepEqual(connectionManager.calls.connect, ["a"], "启用保存触发显式连接");
        await Mcp.saveServer({ id: "a", description: "", transportType: "http", url: "http://a.example.com/mcp", authType: "none", enabled: false });
        assert.deepEqual(connectionManager.calls.connect, ["a"], "停用保存不再触发连接");
    });

    it("T-D6：saveServer 以停用状态保存 → 仍调 invalidate，不调 connect（缓存清空由 invalidate 保证）", async () => {
        const runtime = makeRuntime({ servers: [bearerServer("a")] });
        runtimeHolder.current = runtime;
        const connectionManager = runtime.mcp.connectionManager;
        const res = await Mcp.saveServer({ id: "a", description: "", transportType: "http", url: "http://a.example.com/mcp", authType: "none", enabled: false });
        assert.equal(res.ok, true);
        assert.deepEqual(connectionManager.calls.invalidated, ["a"], "停用保存仍作废该服务器缓存");
        assert.deepEqual(connectionManager.calls.connect, [], "停用保存不发起连接");
    });
});

describe("MCP 进页连接 / 工具清单 / OAuth（T-D1 / T-D3 / T-D5）", () => {
    it("T-D1：connectUnconnected 处理器在管理器挂起期间不返回，结束后返回成功、不 reject", async () => {
        let release: (() => void) | null = null;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const manager = makeConnectionManager();
        manager.connectUnconnected = () => gate;
        runtimeHolder.current = makeRuntime({ connectionManager: manager });
        const pending = Mcp.connectUnconnected();
        let settled = false;
        const probe = pending.then(() => {
            settled = true;
        });
        // 宏任务一拍让 handler 走到 await gate（fake 永不自行 resolve）。
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(settled, false, "管理器挂起期间处理器不返回");
        release?.();
        await probe;
        const res = await pending;
        assert.equal(res.ok, true, "结束后返回成功（管理器永不 reject）");
    });

    it("T-D3：toolList 只读缓存，不触发任何连接请求", async () => {
        const cached: readonly McpToolSnapshot[] = [
            { serverId: "a", toolName: "toolA", toolDescription: "第一个工具" },
            { serverId: "b", toolName: "other" },
        ];
        const manager = makeConnectionManager(cached);
        runtimeHolder.current = makeRuntime({ connectionManager: manager, servers: [bearerServer("a")] });
        const res = await Mcp.toolList({ serverId: "a" });
        assert.equal(res.ok, true);
        if (res.ok) assert.deepEqual(res.data.map((row) => row.toolName), ["toolA"], "只含目标 server 的缓存工具");
        assert.deepEqual([manager.calls.serverTools, manager.calls.cached], [1, 0], "行清单走详情页读取面 serverTools，不走带过滤的装配读取面 cachedTools");
        assert.deepEqual(manager.calls.connect, [], "不发起显式连接");
        assert.equal(manager.calls.connectUnconnected, 0, "不发起进页连接轮");
    });

    it("T-D5：oauthStart 授权成功 → invalidate 后 connect(serverId)，不等连接结果、连接失败仍返回成功", async () => {
        let releaseConnect: (() => void) | null = null;
        const connectGate = new Promise<McpServerStatus>((resolve) => {
            releaseConnect = () => resolve({ serverId: "a", state: "failed", failure: { kind: "network", action: "retry", detail: "ECONNREFUSED" } });
        });
        const manager = makeConnectionManager();
        manager.connect = (serverId) => {
            manager.calls.connect.push(serverId);
            return connectGate;
        };
        // fake 授权双入口：start 在拿到 redirectUrl 后模拟浏览器跳回（loopback 收到 /callback 即收口），
        // handleCallback 直接成功——oauthStart 的授权腿全程不碰真实网络。
        const runtime = makeRuntime({
            servers: [bearerServer("a")],
            connectionManager: manager,
            mcpOAuth: {
                start: async (_serverId, redirectUrl) => {
                    void fetch(`${redirectUrl}?code=auth-code&state=a`).catch(() => undefined);
                    return Result.ok({ authorizeUrl: redirectUrl });
                },
                handleCallback: async () => Result.ok(undefined),
            },
        });
        runtimeHolder.current = runtime;
        const res = await Mcp.oauthStart({ serverId: "a" });
        // oauthStart 在连接收口前就返回：授权成功即动作完成，connect 只挂后台（gate 未释放）。
        assert.equal(res.ok, true, "连接失败不改变 oauthStart 的返回值");
        assert.deepEqual(manager.calls.invalidated, ["a"], "授权成功先作废旧缓存");
        assert.deepEqual(manager.calls.connect, ["a"], "随后对同一 server 发起连接");
        releaseConnect?.();
        await connectGate.catch(() => undefined);
    });
});

describe("MCP 每工具启停（mcp-support D4，与移动端对齐）", () => {
    it("T-MH6：toolList 按 server 过滤并从禁用表取 disabled；setToolDisabled 写后生效", async () => {
        const cached: readonly McpToolSnapshot[] = [
            { serverId: "a", toolName: "toolA", toolDescription: "第一个工具" },
            { serverId: "a", toolName: "toolB" },
            { serverId: "b", toolName: "other" },
        ];
        runtimeHolder.current = makeRuntime({ connectionManager: makeConnectionManager(cached) });
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
