import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AbortError } from "../../src/domain/abort/logic/create-abort-error.js";
import type { McpServerConfig } from "../../src/domain/mcp/model/mcp-server-config.js";
import { McpConnectionManagerFactory } from "../../src/infra/mcp/impl/create-mcp-connection-manager.js";
import type { McpConnectionManager } from "../../src/domain/mcp/ports/mcp-connection.port.js";
import type { McpHttpRequest, McpHttpResponse, McpRequestFn } from "../../src/infra/mcp/ports/mcp-transport.port.js";

/** mock 服务器模式：ok 正常回握与工具清单；http500 回 500 错误页；hang 永不响应（直到 signal 中止）。 */
type StubMode = "ok" | "http500" | "hang";

interface StubSpec {
    readonly id: string;
    readonly mode?: StubMode;
    readonly enabled?: boolean;
    readonly type?: "http" | "stdio";
}

interface RecordedRequest {
    readonly method: string;
    /** 请求发出时携带的 signal（收割后 aborted === true 即 core 侧真断连证据）。 */
    readonly signal: AbortSignal | undefined;
}

interface Harness {
    readonly manager: McpConnectionManager;
    readonly callsOf: (serverId: string) => readonly RecordedRequest[];
}

const urlOf = (id: string): string => `https://mcp.${id}.example.com/mcp`;

const configFor = (spec: StubSpec): McpServerConfig => ({ id: spec.id, description: "", enabled: spec.enabled ?? true, transport: spec.type === "stdio" ? { type: "stdio" } : { type: "http", url: urlOf(spec.id) }, timeoutMs: 120_000, auth: { type: "none" } });

const jsonReply = (id: number | string | undefined, result: unknown): McpHttpResponse => ({ status: 200, headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ jsonrpc: "2.0", id, result }) });

/** T-M18 / T-M18a / T-M19 / T-M11a / T-M11b 的公共 harness：按 URL 路由的 mock requestFn（模拟移动端原生 request 适配——中止以 AbortError reject）。 */
const makeHarness = (specs: readonly StubSpec[], options: { readonly now?: () => number; readonly assemblyBudgetMs?: number } = {}): Harness => {
    const requests = new Map<string, RecordedRequest[]>();
    const requestFn: McpRequestFn = async (request: McpHttpRequest): Promise<McpHttpResponse> => {
        const spec = specs.find((candidate) => request.url === urlOf(candidate.id));
        if (spec === undefined) throw new Error(`mock: 未覆盖的 URL ${request.url}`);
        const message = JSON.parse(request.body) as { id?: number | string; method: string };
        const calls = requests.get(spec.id) ?? [];
        calls.push({ method: message.method, signal: request.signal });
        requests.set(spec.id, calls);
        if (spec.mode === "http500") return { status: 500, headers: { "content-type": "text/plain" }, bodyText: "boom from stub" };
        if (spec.mode === "hang") {
            return await new Promise<McpHttpResponse>((_resolve, reject) => {
                request.signal?.addEventListener("abort", () => reject(AbortError.create()), { once: true });
            });
        }
        if (message.method === "initialize") return jsonReply(message.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: spec.id, version: "1" } });
        if (message.method === "notifications/initialized") return { status: 202, headers: {}, bodyText: "" };
        if (message.method === "tools/list") return jsonReply(message.id, { tools: [{ name: "read", description: "读一下", inputSchema: { type: "object", properties: {} } }] });
        if (message.method === "tools/call") return jsonReply(message.id, { content: [{ type: "text", text: "done" }], isError: false });
        return { status: 500, headers: { "content-type": "text/plain" }, bodyText: `mock: 未覆盖的方法 ${message.method}` };
    };
    const manager = McpConnectionManagerFactory.create({ listServers: () => specs.map(configFor), requestFn, bearerToken: async () => null, ...(options.now === undefined ? {} : {now: options.now}), ...(options.assemblyBudgetMs === undefined ? {} : {assemblyBudgetMs: options.assemblyBudgetMs}) });
    return { manager, callsOf: (serverId) => requests.get(serverId) ?? [] };
};

const statusOf = (manager: McpConnectionManager, serverId: string): (ReturnType<McpConnectionManager["serverStatuses"]>[number]) | undefined => manager.serverStatuses().find((status) => status.serverId === serverId);

describe("McpConnectionManagerFactory.create", () => {
    it("T-M18: 单个 server 连接失败被隔离，其余 server 的快照照常返回", async () => {
        const harness = makeHarness([{ id: "ok-server", mode: "ok" }, { id: "bad-server", mode: "http500" }], { assemblyBudgetMs: 2_000 });
        const snapshots = await harness.manager.snapshotTools();
        assert.deepEqual(snapshots.map((snapshot) => [snapshot.serverId, snapshot.toolName]), [["ok-server", "read"]]);
        const ok = statusOf(harness.manager, "ok-server");
        assert.equal(ok?.state, "ready");
        assert.equal(ok?.toolCount, 1);
        assert.ok(typeof ok?.lastConnectedAt === "number");
        const bad = statusOf(harness.manager, "bad-server");
        assert.equal(bad?.state, "failed");
        assert.equal(bad?.failure?.kind, "server");
        assert.equal(bad?.failure?.action, "retry");
        assert.ok(bad?.failure?.detail.includes("boom from stub"));
    });

    it("T-M18a: 连不上的 server 在装配预算内被收割为 pending，不拖慢其余 server", async () => {
        const budgetMs = 200;
        const harness = makeHarness([{ id: "ok-server", mode: "ok" }, { id: "hung-server", mode: "hang" }], { assemblyBudgetMs: budgetMs });
        const startedAt = Date.now();
        const snapshots = await harness.manager.snapshotTools();
        const elapsed = Date.now() - startedAt;
        assert.ok(elapsed < budgetMs + 2_000, `snapshotTools 应在预算附近返回，实测 ${elapsed}ms`);
        assert.deepEqual(snapshots.map((snapshot) => snapshot.serverId), ["ok-server"]);
        const hung = statusOf(harness.manager, "hung-server");
        assert.equal(hung?.state, "pending");
        assert.equal(hung?.failure?.kind, "network");
        assert.equal(hung?.failure?.action, "retry");
        assert.ok(hung?.failure?.detail.includes("已中止在途请求"));
        // 收割证据：预算到点后，挂在 hang server 上的在途请求 signal 已被中止（requestAbort 由适配层据此落地）。
        const inFlight = harness.callsOf("hung-server")[0];
        assert.equal(inFlight?.method, "initialize");
        assert.equal(inFlight?.signal?.aborted, true);
    });

    it("T-M19: 快照 TTL 过期后重新 tools/list，invalidate 立即失效并重建连接", async () => {
        let clock = 1_000_000;
        const harness = makeHarness([{ id: "s1", mode: "ok" }], { now: () => clock, assemblyBudgetMs: 2_000 });
        const listCalls = () => harness.callsOf("s1").filter((call) => call.method === "tools/list").length;
        const initCalls = () => harness.callsOf("s1").filter((call) => call.method === "initialize").length;
        await harness.manager.snapshotTools();
        assert.equal(listCalls(), 1);
        clock += 59_000;
        await harness.manager.snapshotTools();
        assert.equal(listCalls(), 1, "TTL 内复用快照，不重发 tools/list");
        clock += 2_000;
        await harness.manager.snapshotTools();
        assert.equal(listCalls(), 2, "TTL 过期后重新 tools/list");
        harness.manager.invalidate("s1");
        await harness.manager.snapshotTools();
        assert.equal(listCalls(), 3, "invalidate 后立即重拉");
        assert.equal(initCalls(), 2, "invalidate 同时丢掉常驻连接，重新握手");
    });

    it("T-M11a: stdio 配置不建连，serverStatuses 报 unsupported 并带 fix-config 失败", async () => {
        const harness = makeHarness([{ id: "stdio-server", type: "stdio" }], { assemblyBudgetMs: 200 });
        const snapshots = await harness.manager.snapshotTools();
        assert.equal(snapshots.length, 0);
        assert.equal(harness.callsOf("stdio-server").length, 0);
        const status = statusOf(harness.manager, "stdio-server");
        assert.equal(status?.state, "unsupported");
        assert.equal(status?.failure?.kind, "server");
        assert.equal(status?.failure?.action, "fix-config");
        assert.ok(status?.failure?.detail.includes("暂不支持 stdio"));
    });

    it("T-M11b: stdio 与 http 混配时快照只含 http 工具，stdio 的不可用可从 serverStatuses 读出", async () => {
        const harness = makeHarness([{ id: "stdio-server", type: "stdio" }, { id: "http-server", mode: "ok" }], { assemblyBudgetMs: 200 });
        const snapshots = await harness.manager.snapshotTools();
        assert.deepEqual(snapshots.map((snapshot) => snapshot.serverId), ["http-server"]);
        const states = Object.fromEntries(harness.manager.serverStatuses().map((status) => [status.serverId, status.state]));
        assert.equal(states["http-server"], "ready");
        assert.equal(states["stdio-server"], "unsupported");
    });

    it("disabled 的 server 不进快照不建连，状态报 disabled", async () => {
        const harness = makeHarness([{ id: "off-server", mode: "ok", enabled: false }], { assemblyBudgetMs: 200 });
        const snapshots = await harness.manager.snapshotTools();
        assert.equal(snapshots.length, 0);
        assert.equal(harness.callsOf("off-server").length, 0);
        assert.equal(statusOf(harness.manager, "off-server")?.state, "disabled");
    });

    it("callTool: 正常路径回 Result.ok(CallToolResult)，server 失败回 Result.err(McpFailure) 且状态标 failed", async () => {
        const harness = makeHarness([{ id: "ok-server", mode: "ok" }], { assemblyBudgetMs: 2_000 });
        await harness.manager.snapshotTools();
        const signal = new AbortController().signal;
        const called = await harness.manager.callTool("ok-server", "read", { path: "a.txt" }, signal);
        assert.equal(called.ok, true);
        assert.deepEqual((called as { ok: true; value: unknown }).value, { content: [{ type: "text", text: "done" }], isError: false });
        const missing = await harness.manager.callTool("no-such-server", "read", {}, signal);
        assert.equal(missing.ok, false);
        assert.equal((missing as { ok: false; error: { kind: string } }).error.kind, "protocol");
    });

    it("callTool: stdio / 停用的 server 直接报不可用，不发任何请求", async () => {
        const harness = makeHarness([{ id: "stdio-server", type: "stdio" }, { id: "off-server", enabled: false, mode: "ok" }], { assemblyBudgetMs: 200 });
        const signal = new AbortController().signal;
        const unsupported = await harness.manager.callTool("stdio-server", "read", {}, signal);
        assert.equal(unsupported.ok, false);
        assert.equal((unsupported as { ok: false; error: { action: string; detail: string } }).error.action, "fix-config");
        assert.ok((unsupported as { ok: false; error: { detail: string } }).error.detail.includes("暂不支持 stdio"));
        const disabled = await harness.manager.callTool("off-server", "read", {}, signal);
        assert.equal(disabled.ok, false);
        assert.equal((disabled as { ok: false; error: { detail: string } }).error.detail.includes("已停用"), true);
        assert.equal(harness.callsOf("stdio-server").length, 0);
        assert.equal(harness.callsOf("off-server").length, 0);
    });

    it("callTool: signal 中止时原样以 AbortError reject（取消不进 Result），在途请求被收割", async () => {
        const harness = makeHarness([{ id: "hung-server", mode: "hang" }], { assemblyBudgetMs: 5_000 });
        const controller = new AbortController();
        const pending = harness.manager.callTool("hung-server", "slow", {}, controller.signal);
        const timer = setTimeout(() => controller.abort(), 100);
        try {
            await assert.rejects(pending, (error: unknown) => (error as Error).name === "AbortError");
        } finally {
            clearTimeout(timer);
        }
        const calls = harness.callsOf("hung-server");
        assert.ok(calls.length >= 1);
        assert.equal(calls.some((call) => call.signal?.aborted === true), true);
        const status = statusOf(harness.manager, "hung-server");
        assert.notEqual(status?.state, "failed");
    });
});
