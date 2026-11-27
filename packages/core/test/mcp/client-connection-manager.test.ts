import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AbortError } from "../../src/domain/abort/logic/create-abort-error.js";
import { AssertionError } from "../../src/common/assert.js";
import type { McpFailure } from "../../src/domain/mcp/model/mcp-failure.js";
import type { McpServerConfig } from "../../src/domain/mcp/model/mcp-server-config.js";
import type { McpToolSnapshot } from "../../src/domain/mcp/model/mcp-tool-snapshot.js";
import { McpConnectionManagerFactory } from "../../src/infra/mcp/impl/create-mcp-connection-manager.js";
import type { McpConnectionManager } from "../../src/domain/mcp/ports/mcp-connection.port.js";
import type { McpHttpRequest, McpHttpResponse, McpRequestFn } from "../../src/infra/mcp/ports/mcp-transport.port.js";
import type { Result } from "../../src/errors/either.js";
import type { Interrupt } from "../../src/errors/outcome.js";

/** tools/call 第 n 次的回法（越界按 ok）。refused = 请求函数抛错（没有 HTTP 响应）；hang = 永不响应也永不中止（RequestTimeout 用例靠官方超时赢）。 */
type ToolCallBehavior = "ok" | "refused" | "hang" | "is-error" | "http404" | "http401" | "http403" | "http429" | "http500";

interface StubSpec {
    readonly id: string;
    readonly enabled?: boolean;
    readonly type?: "http" | "stdio";
    /** 单请求超时（缺省 120_000；RequestTimeout 用例注入小值）。 */
    readonly timeoutMs?: number;
    /** tools/list 返回的工具名清单（缺省 ["read"]）。 */
    readonly tools?: readonly string[];
    /** initialize 第 n 次（0 起）挂起到 release，模拟慢握手（重连握手用例 gate 第 1 次）。 */
    readonly gateInitializeAt?: readonly number[];
    /** initialize 第 n 次（0 起）回 500，模拟重连握手失败。 */
    readonly failInitializeAt?: readonly number[];
    /** initialize 响应带 Mcp-Session-Id 头（会话失效判据用）。 */
    readonly sessionAtConnect?: boolean;
    /** tools/call 按次序的回法（越界按 ok）。 */
    readonly toolCalls?: readonly ToolCallBehavior[];
    /** tools/call 第 n 次（0 起）挂起到 release（invalidate 竞态用例用）。 */
    readonly gateToolCallAt?: readonly number[];
}

interface RecordedRequest {
    readonly method: string;
    /** 请求发出时携带的 signal（收割后 aborted === true 即 core 侧真断连证据）。 */
    readonly signal: AbortSignal | undefined;
}

interface Harness {
    readonly manager: McpConnectionManager;
    readonly callsOf: (serverId: string) => readonly RecordedRequest[];
    readonly countOf: (serverId: string, method: string) => number;
    /** 放行该 server 当前挂起的握手 / 调用请求。 */
    readonly release: (serverId: string) => void;
    /** 等该 server 的请求真正挂起（请求已发出）后再继续，避免测试里的时序竞态。 */
    readonly gateReady: (serverId: string) => Promise<void>;
    /** 改某 server 的 tools/list 返回（缓存替换断言用）。 */
    readonly setTools: (serverId: string, tools: readonly string[]) => void;
}

const urlOf = (id: string): string => `https://mcp.${id}.example.com/mcp`;

const configFor = (spec: StubSpec): McpServerConfig => ({id: spec.id, description: "", enabled: spec.enabled ?? true, transport: spec.type === "stdio" ? {type: "stdio"} : {type: "http", url: urlOf(spec.id)}, timeoutMs: spec.timeoutMs ?? 120_000, auth: {type: "none"}});

const jsonReply = (id: number | string | undefined, result: unknown, headers: Readonly<Record<string, string>> = {}): McpHttpResponse => ({status: 200, headers: {"content-type": "application/json", ...headers}, bodyText: JSON.stringify({jsonrpc: "2.0", id, result})});

const statusReply = (status: number, body: string): McpHttpResponse => ({status, headers: {"content-type": "text/plain"}, bodyText: body});

const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** T-C 组的公共 harness：按 URL 路由的 mock requestFn（模拟移动端原生 request 适配——中止以 AbortError reject；挂起的请求在 signal 中止时同样 reject）。 */
const makeHarness = (specs: readonly StubSpec[], options: {readonly now?: () => number; readonly connectBudgetMs?: number; readonly disabledTools?: (serverId: string) => readonly string[]} = {}): Harness => {
    const requests = new Map<string, RecordedRequest[]>();
    const toolLists = new Map<string, readonly string[]>(specs.map((spec) => [spec.id, spec.tools ?? ["read"]]));
    const pendingGates = new Map<string, Array<() => void>>();
    const gateArrived = new Map<string, () => void>();
    const requestFn: McpRequestFn = async (request: McpHttpRequest): Promise<McpHttpResponse> => {
        const spec = specs.find((candidate) => request.url === urlOf(candidate.id));
        if (spec === undefined) throw new Error(`mock: 未覆盖的 URL ${request.url}`);
        const message = JSON.parse(request.body) as {id?: number | string; method: string};
        const calls = requests.get(spec.id) ?? [];
        calls.push({method: message.method, signal: request.signal});
        requests.set(spec.id, calls);
        const nth = (method: string): number => calls.filter((entry) => entry.method === method).length - 1;
        // 挂起请求：release 放行时回正常应答；signal 中止时以 AbortError reject（真断连）。
        const park = (reply: McpHttpResponse): Promise<McpHttpResponse> => new Promise<McpHttpResponse>((resolve, reject) => {
            const onAbort = (): void => reject(AbortError.create());
            request.signal?.addEventListener("abort", onAbort, {once: true});
            const resolvers = pendingGates.get(spec.id) ?? [];
            resolvers.push(() => {
                request.signal?.removeEventListener("abort", onAbort);
                resolve(reply);
            });
            pendingGates.set(spec.id, resolvers);
            gateArrived.get(spec.id)?.();
        });
        if (message.method === "initialize") {
            if (spec.gateInitializeAt?.includes(nth("initialize"))) return await park(jsonReply(message.id, {protocolVersion: "2025-06-18", capabilities: {tools: {}}, serverInfo: {name: spec.id, version: "1"}}, spec.sessionAtConnect === true ? {"Mcp-Session-Id": `sess-${spec.id}`} : {}));
            if (spec.failInitializeAt?.includes(nth("initialize"))) return statusReply(500, "boom from stub");
            return jsonReply(message.id, {protocolVersion: "2025-06-18", capabilities: {tools: {}}, serverInfo: {name: spec.id, version: "1"}}, spec.sessionAtConnect === true ? {"Mcp-Session-Id": `sess-${spec.id}`} : {});
        }
        if (message.method === "notifications/initialized") return {status: 202, headers: {}, bodyText: ""};
        if (message.method === "tools/list") {
            const tools = toolLists.get(spec.id) ?? ["read"];
            return jsonReply(message.id, {tools: tools.map((name) => ({name, description: `${name} 描述`, inputSchema: {type: "object", properties: {}}}))});
        }
        if (message.method === "tools/call") {
            if (spec.gateToolCallAt?.includes(nth("tools/call"))) return await park(jsonReply(message.id, {content: [{type: "text", text: "done"}], isError: false}));
            switch (spec.toolCalls?.[nth("tools/call")] ?? "ok") {
                case "ok": return jsonReply(message.id, {content: [{type: "text", text: "done"}], isError: false});
                case "is-error": return jsonReply(message.id, {content: [{type: "text", text: "工具自己报错"}], isError: true});
                case "refused": throw new Error("ECONNREFUSED");
                case "hang": return await new Promise<McpHttpResponse>(() => {});
                case "http404": return statusReply(404, "gone");
                case "http401": return statusReply(401, "unauthorized");
                case "http403": return statusReply(403, "forbidden");
                case "http429": return statusReply(429, "slow down");
                case "http500": return statusReply(500, "boom from stub");
            }
        }
        return statusReply(500, `mock: 未覆盖的方法 ${message.method}`);
    };
    const manager = McpConnectionManagerFactory.create({listServers: () => specs.map(configFor), requestFn, bearerToken: async () => null, disabledTools: options.disabledTools ?? (() => []), ...(options.now === undefined ? {} : {now: options.now}), ...(options.connectBudgetMs === undefined ? {} : {connectBudgetMs: options.connectBudgetMs})});
    return {
        manager,
        callsOf: (serverId) => requests.get(serverId) ?? [],
        countOf: (serverId, method) => (requests.get(serverId) ?? []).filter((entry) => entry.method === method).length,
        release: (serverId) => {
            const resolvers = pendingGates.get(serverId) ?? [];
            pendingGates.set(serverId, []);
            for (const resolve of resolvers) resolve();
        },
        gateReady: (serverId) => ((pendingGates.get(serverId)?.length ?? 0) > 0 ? Promise.resolve() : new Promise<void>((resolve) => gateArrived.set(serverId, resolve))),
        setTools: (serverId, tools) => toolLists.set(serverId, tools),
    };
};

const statusOf = (manager: McpConnectionManager, serverId: string): (ReturnType<McpConnectionManager["serverStatuses"]>[number]) | undefined => manager.serverStatuses().find((status) => status.serverId === serverId);

/** callTool 返回 union 的收窄：钉住不是取消中断再走 Result 断言（assert.fail 返回 never，出 if 即收窄）。 */
const asResult = (outcome: Result<unknown, McpFailure> | Interrupt, label: string): Result<unknown, McpFailure> => {
    if ("kind" in outcome) assert.fail(`不该返回取消中断（${label}）：${JSON.stringify(outcome)}`);
    return outcome;
};

describe("McpConnectionManagerFactory.create", () => {
    it("T-C1: cachedTools() 同步返回且不发任何请求", () => {
        let requests = 0;
        const manager = McpConnectionManagerFactory.create({listServers: () => [configFor({id: "srv"})], requestFn: async () => {
            requests += 1;
            throw new Error("不应发请求");
        }, bearerToken: async () => null, disabledTools: () => []});
        // 返回值直接按数组标注：cachedTools 若还是 Promise，这一行在类型检查就红（同步契约的编译期锁定）。
        const tools: readonly McpToolSnapshot[] = manager.cachedTools();
        assert.deepEqual(tools, []);
        assert.equal(requests, 0);
        assert.equal(statusOf(manager, "srv")?.state, "pending");
    });

    it("T-C2: connectUnconnected() 只对 pending 发起连接；ready / connecting / failed / disabled / unsupported 不动", async () => {
        const harness = makeHarness([
            {id: "fresh"},
            {id: "ready-srv"},
            {id: "connecting-srv", gateInitializeAt: [0]},
            {id: "failed-srv", failInitializeAt: [0]},
            {id: "off-srv", enabled: false},
            {id: "stdio-srv", type: "stdio"},
        ], {connectBudgetMs: 2_000});
        await harness.manager.connect("ready-srv");
        const connectingRound = harness.manager.connect("connecting-srv");
        await harness.gateReady("connecting-srv");
        await harness.manager.connect("failed-srv");
        assert.equal(statusOf(harness.manager, "fresh")?.state, "pending");
        assert.equal(statusOf(harness.manager, "ready-srv")?.state, "ready");
        assert.equal(statusOf(harness.manager, "connecting-srv")?.state, "connecting");
        assert.equal(statusOf(harness.manager, "failed-srv")?.state, "failed");
        assert.equal(statusOf(harness.manager, "off-srv")?.state, "disabled");
        assert.equal(statusOf(harness.manager, "stdio-srv")?.state, "unsupported");
        const round = harness.manager.connectUnconnected();
        // 同步落表：调用一返回，fresh 已是 connecting（请求此时尚未上线，计数断言放在轮次结束后）。
        assert.equal(statusOf(harness.manager, "fresh")?.state, "connecting");
        harness.release("connecting-srv");
        await Promise.all([connectingRound, round]);
        // 只有 fresh 被触发；其余各状态的原请求计数不变（connecting 撞上的在途尝试也不重发）。
        assert.equal(harness.countOf("fresh", "initialize"), 1);
        assert.equal(harness.countOf("ready-srv", "initialize"), 1);
        assert.equal(harness.countOf("connecting-srv", "initialize"), 1);
        assert.equal(harness.countOf("failed-srv", "initialize"), 1);
        assert.equal(harness.countOf("off-srv", "initialize"), 0);
        assert.equal(harness.countOf("stdio-srv", "initialize"), 0);
        assert.equal(statusOf(harness.manager, "fresh")?.state, "ready");
    });

    it("T-C3: connectUnconnected() 对 disconnected 发起连接，成功后缓存整体替换", async () => {
        const harness = makeHarness([{id: "srv", toolCalls: ["refused"], failInitializeAt: [1]}], {connectBudgetMs: 2_000});
        await harness.manager.connectUnconnected();
        assert.deepEqual(harness.manager.cachedTools().map((tool) => tool.toolName), ["read"]);
        await harness.manager.callTool("srv", "read", {}, new AbortController().signal);
        assert.equal(statusOf(harness.manager, "srv")?.state, "disconnected");
        assert.deepEqual(harness.manager.cachedTools().map((tool) => tool.toolName), ["read"], "已断开期间缓存保留");
        harness.setTools("srv", ["read", "write"]);
        await harness.manager.connectUnconnected();
        assert.equal(statusOf(harness.manager, "srv")?.state, "ready");
        assert.deepEqual(harness.manager.cachedTools().map((tool) => tool.toolName), ["read", "write"], "重连成功后缓存整体替换");
        assert.equal(harness.countOf("srv", "initialize"), 3, "首次连接 + 调用时重连失败 + 本轮重连");
        assert.equal(harness.countOf("srv", "tools/list"), 2);
    });

    it("T-C4: connectUnconnected() 连续三次共享一次尝试；三个 Promise 都在尝试结束后才 resolve", async () => {
        const harness = makeHarness([{id: "srv", gateInitializeAt: [0]}], {connectBudgetMs: 5_000});
        const rounds = [harness.manager.connectUnconnected(), harness.manager.connectUnconnected(), harness.manager.connectUnconnected()];
        await harness.gateReady("srv");
        assert.equal(harness.countOf("srv", "initialize"), 1, "只有一次握手");
        let settled = 0;
        for (const round of rounds) void round.then(() => {
            settled += 1;
        });
        await sleep(20);
        assert.equal(settled, 0, "尝试未结束前三个 Promise 都不 resolve");
        harness.release("srv");
        await Promise.all(rounds);
        assert.equal(settled, 3);
        assert.equal(harness.countOf("srv", "initialize"), 1);
        assert.equal(harness.countOf("srv", "tools/list"), 1);
    });

    it("T-C5: connect(id) 先作废在途尝试再连接，返回终态状态；被作废的在途结果不写回", async () => {
        const harness = makeHarness([{id: "srv", gateInitializeAt: [0]}], {connectBudgetMs: 5_000});
        const background = harness.manager.connectUnconnected();
        await harness.gateReady("srv");
        const status = await harness.manager.connect("srv");
        assert.equal(status.state, "ready");
        harness.release("srv");
        await background;
        assert.equal(harness.countOf("srv", "initialize"), 2);
        assert.equal(harness.countOf("srv", "tools/list"), 1, "被作废的旧尝试不再 tools/list");
        assert.equal(statusOf(harness.manager, "srv")?.state, "ready");
    });

    it("T-C6: pending 连接失败 → failed 且缓存为空；之后再 connectUnconnected() 不重试", async () => {
        const harness = makeHarness([{id: "srv", failInitializeAt: [0]}], {connectBudgetMs: 2_000});
        await harness.manager.connectUnconnected();
        const status = statusOf(harness.manager, "srv");
        assert.equal(status?.state, "failed");
        assert.equal(status?.failure?.kind, "server");
        assert.deepEqual(harness.manager.cachedTools(), []);
        const before = harness.countOf("srv", "initialize");
        await harness.manager.connectUnconnected();
        assert.equal(harness.countOf("srv", "initialize"), before, "failed 之后进页面不重试");
    });

    it("T-C7: 无过期时间——now 前进 10 分钟后缓存不变、无请求", async () => {
        let clock = 1_000_000;
        const harness = makeHarness([{id: "srv"}], {now: () => clock, connectBudgetMs: 2_000});
        await harness.manager.connectUnconnected();
        assert.deepEqual(harness.manager.cachedTools().map((tool) => tool.toolName), ["read"]);
        clock += 600_000;
        assert.deepEqual(harness.manager.cachedTools().map((tool) => tool.toolName), ["read"]);
        assert.equal(harness.countOf("srv", "tools/list"), 1);
        await harness.manager.connectUnconnected();
        assert.equal(harness.countOf("srv", "initialize"), 1, "ready 不重连");
    });

    it("T-C8: 调用遇连接级失败（无 HTTP 响应）→ 重连一次重试一次，返回重试结果，状态 ready", async () => {
        const harness = makeHarness([{id: "srv", toolCalls: ["refused"]}], {connectBudgetMs: 2_000});
        await harness.manager.connectUnconnected();
        const outcome = asResult(await harness.manager.callTool("srv", "read", {}, new AbortController().signal), "T-C8");
        assert.ok(outcome.ok);
        assert.deepEqual(outcome.value, {content: [{type: "text", text: "done"}], isError: false});
        assert.equal(harness.countOf("srv", "tools/call"), 2);
        assert.equal(harness.countOf("srv", "initialize"), 2);
        assert.equal(statusOf(harness.manager, "srv")?.state, "ready");
    });

    it("T-C8b: 重连成功但重试的调用又失败 → 按那次失败原样返回，状态 ready，不再第二次重连", async () => {
        const harness = makeHarness([{id: "srv", toolCalls: ["refused", "http500"]}], {connectBudgetMs: 2_000});
        await harness.manager.connectUnconnected();
        const outcome = asResult(await harness.manager.callTool("srv", "read", {}, new AbortController().signal), "T-C8b");
        assert.ok(!outcome.ok);
        assert.equal(outcome.error.kind, "server");
        assert.equal(harness.countOf("srv", "tools/call"), 2);
        assert.equal(harness.countOf("srv", "initialize"), 2);
        assert.equal(statusOf(harness.manager, "srv")?.state, "ready");
    });

    it("T-C9: 握手下发过会话编号后调用遇 404 → 视为会话失效，走重连重试", async () => {
        const harness = makeHarness([{id: "srv", sessionAtConnect: true, toolCalls: ["http404"]}], {connectBudgetMs: 2_000});
        await harness.manager.connectUnconnected();
        const outcome = asResult(await harness.manager.callTool("srv", "read", {}, new AbortController().signal), "T-C9");
        assert.ok(outcome.ok, "404 且此前持有会话 → 重连后重试成功");
        assert.equal(harness.countOf("srv", "tools/call"), 2);
        assert.equal(statusOf(harness.manager, "srv")?.state, "ready");
    });

    it("T-C10: 从未下发会话编号时调用遇 404 → 不重连，按普通失败分类返回", async () => {
        const harness = makeHarness([{id: "srv", toolCalls: ["http404"]}], {connectBudgetMs: 2_000});
        await harness.manager.connectUnconnected();
        const outcome = asResult(await harness.manager.callTool("srv", "read", {}, new AbortController().signal), "T-C10");
        assert.ok(!outcome.ok);
        assert.equal(outcome.error.kind, "unknown");
        assert.equal(outcome.error.status, 404);
        assert.equal(harness.countOf("srv", "tools/call"), 1);
        assert.equal(harness.countOf("srv", "initialize"), 1, "地址配错的 404 不重连");
        assert.equal(statusOf(harness.manager, "srv")?.state, "ready");
    });

    it("T-C11: 调用重连失败 → 状态 disconnected，缓存条目与之前逐条深相等", async () => {
        const harness = makeHarness([{id: "srv", toolCalls: ["refused"], failInitializeAt: [1]}], {connectBudgetMs: 2_000});
        await harness.manager.connectUnconnected();
        const before = harness.manager.cachedTools();
        const outcome = asResult(await harness.manager.callTool("srv", "read", {}, new AbortController().signal), "T-C11");
        assert.ok(!outcome.ok);
        assert.equal(statusOf(harness.manager, "srv")?.state, "disconnected");
        assert.deepEqual(harness.manager.cachedTools(), before);
    });

    it("T-C12: 服务器报的错（401/403/429/5xx/isError）不重连，状态与缓存不变", async () => {
        const harness = makeHarness([
            {id: "auth-srv", toolCalls: ["http401"]},
            {id: "permission-srv", toolCalls: ["http403"]},
            {id: "rate-srv", toolCalls: ["http429"]},
            {id: "server-srv", toolCalls: ["http500"]},
            {id: "is-error-srv", toolCalls: ["is-error"]},
        ], {connectBudgetMs: 2_000});
        await harness.manager.connectUnconnected();
        const cacheBefore = harness.manager.cachedTools();
        const signal = new AbortController().signal;
        const expectedKinds = ["auth", "permission", "rate-limit", "server"];
        const servers = ["auth-srv", "permission-srv", "rate-srv", "server-srv"];
        for (const [index, serverId] of servers.entries()) {
            const outcome = asResult(await harness.manager.callTool(serverId, "read", {}, signal), `T-C12 ${serverId}`);
            assert.ok(!outcome.ok);
            assert.equal(outcome.error.kind, expectedKinds[index]);
            assert.equal(harness.countOf(serverId, "tools/call"), 1, `${serverId} 不重连`);
            assert.equal(statusOf(harness.manager, serverId)?.state, "ready", `${serverId} 状态不变`);
        }
        const isError = asResult(await harness.manager.callTool("is-error-srv", "read", {}, signal), "T-C12 isError");
        assert.ok(isError.ok, "isError 原样返回，不在管理器层转失败");
        assert.equal(harness.countOf("is-error-srv", "tools/call"), 1);
        assert.deepEqual(harness.manager.cachedTools().length, cacheBefore.length);
    });

    it("T-C13: 调用与重试期间用户取消 → Interrupt.cancelled，状态不变", async () => {
        // 调用期间取消：hang 的调用被 signal 中止，状态与缓存都不动。
        const hanging = makeHarness([{id: "srv", toolCalls: ["hang"]}], {connectBudgetMs: 5_000});
        await hanging.manager.connectUnconnected();
        assert.deepEqual(hanging.manager.cachedTools().map((tool) => tool.toolName), ["read"]);
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 50);
        assert.deepEqual(await hanging.manager.callTool("srv", "read", {}, controller.signal), {kind: "cancelled", reason: "user-stop"});
        assert.equal(statusOf(hanging.manager, "srv")?.state, "ready");
        assert.deepEqual(hanging.manager.cachedTools().map((tool) => tool.toolName), ["read"]);
        assert.equal(hanging.countOf("srv", "tools/call"), 1);
        // 重试期间取消：第一次调用 refused 触发重连，重连成功后的重试调用挂起时中止。
        const retried = makeHarness([{id: "srv", toolCalls: ["refused", "hang"]}], {connectBudgetMs: 5_000});
        await retried.manager.connectUnconnected();
        const retryController = new AbortController();
        const pending = retried.manager.callTool("srv", "read", {}, retryController.signal);
        while (retried.countOf("srv", "tools/call") < 2) await sleep(5);
        retryController.abort();
        assert.deepEqual(await pending, {kind: "cancelled", reason: "user-stop"});
        assert.equal(statusOf(retried.manager, "srv")?.state, "ready");
    });

    it("T-C13b: 取消落在本调用发起的重连握手期间 → Interrupt.cancelled，状态 disconnected，缓存保留；之后 connectUnconnected() 会再次尝试", async () => {
        const harness = makeHarness([{id: "srv", toolCalls: ["refused"], gateInitializeAt: [1]}], {connectBudgetMs: 5_000});
        await harness.manager.connectUnconnected();
        const controller = new AbortController();
        const pending = harness.manager.callTool("srv", "read", {}, controller.signal);
        await harness.gateReady("srv");
        assert.equal(statusOf(harness.manager, "srv")?.state, "connecting");
        controller.abort();
        assert.deepEqual(await pending, {kind: "cancelled", reason: "user-stop"});
        assert.equal(statusOf(harness.manager, "srv")?.state, "disconnected");
        assert.deepEqual(harness.manager.cachedTools().map((tool) => tool.toolName), ["read"]);
        harness.release("srv");
        await harness.manager.connectUnconnected();
        assert.equal(statusOf(harness.manager, "srv")?.state, "ready", "不会卡在连接中");
    });

    it("T-C13c: 调用时撞上后台入口的在途握手，期间用户取消 → Interrupt.cancelled，状态由那次握手的结果决定", async () => {
        const harness = makeHarness([{id: "srv", gateInitializeAt: [0]}], {connectBudgetMs: 5_000});
        const background = harness.manager.connectUnconnected();
        await harness.gateReady("srv");
        const controller = new AbortController();
        const pending = harness.manager.callTool("srv", "read", {}, controller.signal);
        await sleep(5);
        controller.abort();
        assert.deepEqual(await pending, {kind: "cancelled", reason: "user-stop"});
        harness.release("srv");
        await background;
        assert.equal(statusOf(harness.manager, "srv")?.state, "ready", "后台握手按自己的结果写回，不受本调用影响");
    });

    it("T-C14: disconnected 经 connectUnconnected() 再失败 → 仍 disconnected，缓存保留，原因更新", async () => {
        // 第一段失败来自调用时重连（握手 http500）；第二轮连接用 gate 挂起、预算到点收割，原因文本不同。
        const harness = makeHarness([{id: "srv", toolCalls: ["refused"], failInitializeAt: [1], gateInitializeAt: [2]}], {connectBudgetMs: 200});
        await harness.manager.connectUnconnected();
        await harness.manager.callTool("srv", "read", {}, new AbortController().signal);
        const first = statusOf(harness.manager, "srv");
        assert.equal(first?.state, "disconnected");
        assert.ok(first?.failure?.detail.includes("boom from stub"));
        const round = harness.manager.connectUnconnected();
        await harness.gateReady("srv");
        await round;   // 不放行：连接预算 200ms 到点把挂起的握手收割掉
        const second = statusOf(harness.manager, "srv");
        assert.equal(second?.state, "disconnected");
        assert.ok(second?.failure?.detail.includes("预算内未完成"), "失败原因随最近一次尝试更新");
        assert.deepEqual(harness.manager.cachedTools().map((tool) => tool.toolName), ["read"]);
        assert.equal(harness.countOf("srv", "initialize"), 3, "首次连接 + 调用时重连 + 本轮重连");
    });

    it("T-C15: 重连不递增代际，但期间并发的 invalidate 仍能使重连结果作废", async () => {
        const harness = makeHarness([{id: "srv", toolCalls: ["refused"], gateInitializeAt: [1]}], {connectBudgetMs: 5_000});
        await harness.manager.connectUnconnected();
        const pending = harness.manager.callTool("srv", "read", {}, new AbortController().signal);
        await harness.gateReady("srv");
        harness.manager.invalidate("srv");
        harness.release("srv");
        const outcome = asResult(await pending, "T-C15");
        assert.ok(!outcome.ok);
        assert.ok(outcome.error.detail.includes("已被更新的配置取代"));
        assert.equal(statusOf(harness.manager, "srv")?.state, "pending");
        assert.deepEqual(harness.manager.cachedTools(), []);
    });

    it("T-C16: 从未连上的起点在连接预算内未完成 → failed，不拖慢其余 server", async () => {
        const budgetMs = 200;
        const harness = makeHarness([{id: "ok-server"}, {id: "hung-server", gateInitializeAt: [0]}], {connectBudgetMs: budgetMs});
        const startedAt = Date.now();
        await harness.manager.connectUnconnected();
        const elapsed = Date.now() - startedAt;
        assert.ok(elapsed < budgetMs + 2_000, `connectUnconnected 应在预算附近返回，实测 ${elapsed}ms`);
        assert.equal(statusOf(harness.manager, "ok-server")?.state, "ready");
        const hung = statusOf(harness.manager, "hung-server");
        assert.equal(hung?.state, "failed");
        assert.equal(hung?.failure?.kind, "network");
        assert.equal(hung?.failure?.action, "retry");
        assert.ok(hung?.failure?.detail.includes("预算内未完成"));
        // 收割证据：预算到点后，挂在 hung server 上的在途请求 signal 已被中止（requestAbort 由适配层据此落地）。
        const inFlight = harness.callsOf("hung-server")[0];
        assert.equal(inFlight?.method, "initialize");
        assert.equal(inFlight?.signal?.aborted, true);
    });

    it("T-C17: 撞名 server 标 failed{protocol,report}，缓存条目保留，cachedTools 不返回其工具；检测不联网", async () => {
        const harness = makeHarness([{id: "a.b", tools: ["read"]}, {id: "a_b", tools: ["read"]}, {id: "ok", tools: ["query"]}], {connectBudgetMs: 2_000});
        await harness.manager.connectUnconnected();
        const tools = harness.manager.cachedTools();
        assert.deepEqual(tools.map((tool) => [tool.serverId, tool.toolName]), [["ok", "query"]], "读取即检测，撞名 server 的工具不返回");
        const statuses = Object.fromEntries(harness.manager.serverStatuses().map((status) => [status.serverId, status]));
        for (const serverId of ["a.b", "a_b"]) {
            const status = statuses[serverId];
            assert.equal(status?.state, "failed");
            assert.equal(status?.failure?.kind, "protocol");
            assert.equal(status?.failure?.action, "report");
            assert.ok(status?.failure?.detail.includes("mcp__a_b__read"));
            assert.ok(typeof status?.lastConnectedAt === "number", "撞名标记保留 lastConnectedAt");
        }
        assert.equal(statuses["ok"]?.state, "ready");
        const listCalls = harness.countOf("a.b", "tools/list") + harness.countOf("a_b", "tools/list") + harness.countOf("ok", "tools/list");
        void harness.manager.cachedTools();
        void harness.manager.serverStatuses();
        assert.equal(harness.countOf("a.b", "tools/list") + harness.countOf("a_b", "tools/list") + harness.countOf("ok", "tools/list"), listCalls, "反复读取不联网");
    });

    it("T-C17b: 起点为 disconnected 的服务器被撞名标记后冲突消失 → 恢复为 disconnected（不是 ready）", async () => {
        const harness = makeHarness([{id: "a.b", tools: ["read"], toolCalls: ["refused"], failInitializeAt: [1]}, {id: "a_b", tools: ["read"]}], {connectBudgetMs: 2_000});
        await harness.manager.connectUnconnected();
        await harness.manager.callTool("a.b", "read", {}, new AbortController().signal);
        // 冲突仍在：每次读取都会把涉事双方标回 failed（起点 disconnected 也一样），所以「断开」状态只在冲突消失后才观测得到。
        assert.deepEqual(harness.manager.cachedTools().map((tool) => tool.serverId), [], "读取即检测，冲突仍在");
        assert.equal(statusOf(harness.manager, "a.b")?.state, "failed");
        harness.manager.invalidate("a_b");
        assert.equal(statusOf(harness.manager, "a.b")?.state, "disconnected", "冲突消失后按连接是否还在恢复");
        assert.deepEqual(harness.manager.cachedTools().map((tool) => tool.serverId), ["a.b"]);
    });

    it("T-C18: closeAll 后在途的 connectUnconnected 结果不写回", async () => {
        const harness = makeHarness([{id: "srv", gateInitializeAt: [0]}], {connectBudgetMs: 5_000});
        const pending = harness.manager.connectUnconnected();
        await harness.gateReady("srv");
        await harness.manager.closeAll();
        harness.release("srv");
        await pending;
        assert.equal(statusOf(harness.manager, "srv")?.state, "pending");
        assert.deepEqual(harness.manager.cachedTools(), []);
    });

    it("T-C19: disconnected 的服务器调 connect(id) 失败 → failed，缓存清空（显式动作等同全新连接）", async () => {
        const harness = makeHarness([{id: "srv", toolCalls: ["refused"], failInitializeAt: [1, 2]}], {connectBudgetMs: 2_000});
        await harness.manager.connectUnconnected();
        await harness.manager.callTool("srv", "read", {}, new AbortController().signal);
        assert.equal(statusOf(harness.manager, "srv")?.state, "disconnected");
        const status = await harness.manager.connect("srv");
        assert.equal(status.state, "failed");
        assert.deepEqual(harness.manager.cachedTools(), []);
    });

    it("T-C20: A 先连上并缓存，B 后连上且撞名 → 读取时 A、B 都标 failed{protocol,report}，工具都不返回", async () => {
        const harness = makeHarness([{id: "a.b", tools: ["read"]}, {id: "a_b", tools: ["read", "write"]}], {connectBudgetMs: 2_000});
        await harness.manager.connect("a.b");
        assert.deepEqual(harness.manager.cachedTools().map((tool) => tool.toolName), ["read"], "B 连上之前没有冲突");
        await harness.manager.connect("a_b");
        assert.deepEqual(harness.manager.cachedTools(), []);
        const states = Object.fromEntries(harness.manager.serverStatuses().map((status) => [status.serverId, status.state]));
        assert.equal(states["a.b"], "failed");
        assert.equal(states["a_b"], "failed");
    });

    it("T-C21: disabledTools 关掉的工具不出现在 cachedTools；关掉撞名工具之一后不再视为撞名", async () => {
        const disabled = new Map<string, readonly string[]>([["a_b", ["read"]]]);
        const harness = makeHarness([{id: "a.b", tools: ["read", "write"]}, {id: "a_b", tools: ["read"]}, {id: "ok", tools: ["query"]}], {connectBudgetMs: 2_000, disabledTools: (serverId) => disabled.get(serverId) ?? []});
        await harness.manager.connectUnconnected();
        assert.deepEqual(harness.manager.cachedTools().map((tool) => [tool.serverId, tool.toolName]), [["a.b", "read"], ["a.b", "write"], ["ok", "query"]], "检测前先按 disabledTools 过滤：a_b 的 read 被关掉不参与撞名，a.b 的工具照常返回");
        const states = Object.fromEntries(harness.manager.serverStatuses().map((status) => [status.serverId, status.state]));
        assert.equal(states["a.b"], "ready");
        assert.equal(states["a_b"], "ready");
        disabled.set("a_b", []);
        assert.deepEqual(harness.manager.cachedTools().map((tool) => tool.serverId), ["ok"], "把撞名工具打开后再读即标记");
        const marked = Object.fromEntries(harness.manager.serverStatuses().map((status) => [status.serverId, status.state]));
        assert.equal(marked["a.b"], "failed");
        assert.equal(marked["a_b"], "failed");
    });

    it("T-C22: connectUnconnected() 调用后立刻读状态，被触发的服务器已是 connecting（同步落表）", async () => {
        const harness = makeHarness([{id: "srv", gateInitializeAt: [0]}], {connectBudgetMs: 5_000});
        const round = harness.manager.connectUnconnected();
        assert.equal(statusOf(harness.manager, "srv")?.state, "connecting");
        harness.release("srv");
        await round;
    });

    it("T-C23: disconnected 的服务器被调用：先重连——成功则 ready + 缓存替换 + 执行调用；失败则仍 disconnected + 缓存保留 + 按失败返回", async () => {
        // 成功分支：重连握手换新缓存，然后执行这次调用。
        const ok = makeHarness([{id: "srv", toolCalls: ["refused"]}], {connectBudgetMs: 2_000});
        await ok.manager.connectUnconnected();
        ok.setTools("srv", ["read", "write"]);
        const good = asResult(await ok.manager.callTool("srv", "read", {}, new AbortController().signal), "T-C23 成功");
        assert.ok(good.ok);
        assert.equal(statusOf(ok.manager, "srv")?.state, "ready");
        assert.deepEqual(ok.manager.cachedTools().map((tool) => tool.toolName), ["read", "write"], "重连时缓存已替换");
        assert.equal(ok.countOf("srv", "initialize"), 2);
        assert.equal(ok.countOf("srv", "tools/call"), 2);
        // 失败分支：重连握手失败 → 仍 disconnected、缓存保留、调用按失败返回。
        const bad = makeHarness([{id: "srv", toolCalls: ["refused"], failInitializeAt: [1]}], {connectBudgetMs: 2_000});
        await bad.manager.connectUnconnected();
        const before = bad.manager.cachedTools();
        const failure = asResult(await bad.manager.callTool("srv", "read", {}, new AbortController().signal), "T-C23 失败");
        assert.ok(!failure.ok);
        assert.equal(statusOf(bad.manager, "srv")?.state, "disconnected");
        assert.deepEqual(bad.manager.cachedTools(), before);
    });

    it("T-C24: 单次请求超时（RequestTimeout）不重连：tools/call 只 1 次，状态与缓存不变", async () => {
        const harness = makeHarness([{id: "srv", toolCalls: ["hang"], timeoutMs: 100}], {connectBudgetMs: 5_000});
        await harness.manager.connectUnconnected();
        const outcome = asResult(await harness.manager.callTool("srv", "read", {}, new AbortController().signal), "T-C24");
        assert.ok(!outcome.ok);
        assert.equal(outcome.error.kind, "network");
        assert.equal(harness.countOf("srv", "tools/call"), 1);
        assert.equal(harness.countOf("srv", "initialize"), 1);
        assert.equal(statusOf(harness.manager, "srv")?.state, "ready");
        assert.deepEqual(harness.manager.cachedTools().map((tool) => tool.toolName), ["read"]);
    });

    it("T-C25: 撞名双方标 failed 后停用一方 → 另一方恢复 ready、无需重连、工具重新出现", async () => {
        const harness = makeHarness([{id: "a.b", tools: ["read"]}, {id: "a_b", tools: ["read", "write"]}], {connectBudgetMs: 2_000});
        await harness.manager.connectUnconnected();
        assert.deepEqual(harness.manager.cachedTools(), []);
        harness.manager.invalidate("a_b");
        assert.deepEqual(harness.manager.cachedTools().map((tool) => [tool.serverId, tool.toolName]), [["a.b", "read"]]);
        assert.equal(statusOf(harness.manager, "a.b")?.state, "ready");
        assert.equal(harness.countOf("a.b", "initialize"), 1, "恢复来自标记清除，不重连");
    });

    it("T-C25b: 同一服务器两个归一后同名的工具：关掉其一后读取无冲突、状态 ready；再打开即记 failed{protocol}，不抛异常", async () => {
        const disabled = new Map<string, readonly string[]>();
        const harness = makeHarness([{id: "srv", tools: ["dup", "dup"]}], {connectBudgetMs: 2_000, disabledTools: (serverId) => disabled.get(serverId) ?? []});
        await harness.manager.connectUnconnected();
        void harness.manager.cachedTools();
        assert.equal(statusOf(harness.manager, "srv")?.state, "failed");
        disabled.set("srv", ["dup"]);
        assert.equal(statusOf(harness.manager, "srv")?.state, "ready", "被关掉的工具不参与撞名，连接还在 → ready");
        disabled.set("srv", []);
        assert.equal(statusOf(harness.manager, "srv")?.state, "failed", "再打开后再读即标记");
        assert.equal(statusOf(harness.manager, "srv")?.failure?.kind, "protocol");
    });

    it("T-C26: ready 的服务器调 connect(id) 失败 → failed，缓存清空", async () => {
        const harness = makeHarness([{id: "srv", failInitializeAt: [1]}], {connectBudgetMs: 2_000});
        await harness.manager.connectUnconnected();
        assert.deepEqual(harness.manager.cachedTools().map((tool) => tool.toolName), ["read"]);
        const status = await harness.manager.connect("srv");
        assert.equal(status.state, "failed");
        assert.deepEqual(harness.manager.cachedTools(), []);
    });

    it("T-C27: 对 disabled / unsupported 的服务器调 connect(id) → 不发请求，原样返回当前状态", async () => {
        const harness = makeHarness([{id: "off", enabled: false}, {id: "stdio", type: "stdio"}], {connectBudgetMs: 2_000});
        const off = await harness.manager.connect("off");
        assert.equal(off.state, "disabled");
        const stdio = await harness.manager.connect("stdio");
        assert.equal(stdio.state, "unsupported");
        assert.ok(stdio.failure?.detail.includes("暂不支持 stdio"));
        assert.equal(harness.countOf("off", "initialize"), 0);
        assert.equal(harness.countOf("stdio", "initialize"), 0);
    });

    it("T-C28: connect(id) 传未知 id → 抛 AssertionError（不变量破坏）", async () => {
        const harness = makeHarness([{id: "srv"}], {connectBudgetMs: 2_000});
        await assert.rejects(harness.manager.connect("no-such"), (error: unknown) => error instanceof AssertionError);
    });

    it("T-C29: 分类结果同为 network 的两种失败——没有 HTTP 响应的重连，RequestTimeout 不重连（判据来自原始错误）", async () => {
        const refused = makeHarness([{id: "srv", toolCalls: ["refused"]}], {connectBudgetMs: 2_000});
        await refused.manager.connectUnconnected();
        const lost = asResult(await refused.manager.callTool("srv", "read", {}, new AbortController().signal), "T-C29 无响应");
        assert.ok(lost.ok);
        assert.equal(refused.countOf("srv", "tools/call"), 2, "无 HTTP 响应 → 重连 + 重试");
        const timeout = makeHarness([{id: "srv", toolCalls: ["hang"], timeoutMs: 100}], {connectBudgetMs: 5_000});
        await timeout.manager.connectUnconnected();
        const timedOut = asResult(await timeout.manager.callTool("srv", "read", {}, new AbortController().signal), "T-C29 超时");
        assert.ok(!timedOut.ok);
        assert.equal(timeout.countOf("srv", "tools/call"), 1, "单次请求超时 → 不重连");
    });

    it("T-C30: 对 pending / failed 的服务器调 callTool → 不发请求、状态不变、返回 unknown「未连接」", async () => {
        const harness = makeHarness([{id: "fresh"}, {id: "broken", failInitializeAt: [0]}], {connectBudgetMs: 2_000});
        await harness.manager.connect("broken");
        assert.equal(statusOf(harness.manager, "broken")?.state, "failed");
        const signal = new AbortController().signal;
        for (const serverId of ["fresh", "broken"]) {
            const outcome = asResult(await harness.manager.callTool(serverId, "read", {}, signal), `T-C30 ${serverId}`);
            assert.ok(!outcome.ok);
            assert.equal(outcome.error.kind, "unknown");
            assert.equal(outcome.error.action, "report");
            assert.ok(outcome.error.detail.includes("未连接"));
        }
        assert.equal(harness.countOf("fresh", "initialize"), 0, "pending 起点不悄悄连上");
        assert.equal(harness.countOf("broken", "initialize"), 1, "failed 起点不发新请求");
        assert.equal(statusOf(harness.manager, "fresh")?.state, "pending");
        assert.equal(statusOf(harness.manager, "broken")?.state, "failed");
    });

    it("T-C30b: 服务器处于 connecting（后台握手在途）时调 callTool → 只有一次握手；握手成功后照常执行调用", async () => {
        const harness = makeHarness([{id: "srv", gateInitializeAt: [0]}], {connectBudgetMs: 5_000});
        const background = harness.manager.connectUnconnected();
        await harness.gateReady("srv");
        const pending = harness.manager.callTool("srv", "read", {}, new AbortController().signal);
        harness.release("srv");
        const outcome = asResult(await pending, "T-C30b");
        await background;
        assert.ok(outcome.ok);
        assert.equal(harness.countOf("srv", "initialize"), 1);
        assert.equal(harness.countOf("srv", "tools/call"), 1);
        assert.equal(statusOf(harness.manager, "srv")?.state, "ready");
    });

    it("T-C31: callTool 触发重连的握手期间读 serverStatuses() 为 connecting", async () => {
        const harness = makeHarness([{id: "srv", toolCalls: ["refused"], gateInitializeAt: [1]}], {connectBudgetMs: 5_000});
        await harness.manager.connectUnconnected();
        const pending = harness.manager.callTool("srv", "read", {}, new AbortController().signal);
        await harness.gateReady("srv");
        assert.equal(statusOf(harness.manager, "srv")?.state, "connecting");
        harness.release("srv");
        const outcome = asResult(await pending, "T-C31");
        assert.ok(outcome.ok);
        assert.equal(statusOf(harness.manager, "srv")?.state, "ready");
    });

    it("invalidate 与在途 connectUnconnected 交错：旧配置的结果不写回，下一次连接走新握手", async () => {
        const harness = makeHarness([{id: "srv", gateInitializeAt: [0]}], {connectBudgetMs: 5_000});
        const first = harness.manager.connectUnconnected();
        await harness.gateReady("srv");
        harness.manager.invalidate("srv");
        harness.release("srv");
        await first;
        assert.equal(statusOf(harness.manager, "srv")?.state, "pending");
        await harness.manager.connectUnconnected();
        assert.equal(statusOf(harness.manager, "srv")?.state, "ready");
        assert.equal(harness.countOf("srv", "initialize"), 2);
    });

    it("invalidate 与在途 callTool 交错：旧连接被关掉、该次调用以失败结束，但不把结果写回状态", async () => {
        const harness = makeHarness([{id: "srv", gateToolCallAt: [0]}], {connectBudgetMs: 5_000});
        await harness.manager.connectUnconnected();
        const call = harness.manager.callTool("srv", "read", {}, new AbortController().signal);
        await harness.gateReady("srv");
        harness.manager.invalidate("srv");
        harness.release("srv");
        const outcome = asResult(await call, "invalidate 交错");
        assert.ok(!outcome.ok, "invalidate 先关旧连接，在途调用随之失败");
        assert.equal(statusOf(harness.manager, "srv")?.state, "pending", "结果不写回状态（条目已被作废）");
    });

    it("请求函数自身失败（没有响应）归 network / retry，不落 unknown", async () => {
        const manager = McpConnectionManagerFactory.create({listServers: () => [configFor({id: "srv"})], disabledTools: () => [], bearerToken: async () => null, requestFn: async () => { throw new Error("ECONNREFUSED"); }});
        await manager.connectUnconnected();
        const status = statusOf(manager, "srv");
        assert.equal(status?.state, "failed");
        assert.equal(status?.failure?.kind, "network");
        assert.equal(status?.failure?.action, "retry");
        assert.ok(status?.failure?.detail.includes("ECONNREFUSED"));
    });

    it("callTool: 服务器不在配置里 → protocol 失败；stdio / 停用的 server 直接报不可用，不发任何请求", async () => {
        const harness = makeHarness([{id: "stdio-server", type: "stdio"}, {id: "off-server", enabled: false}], {connectBudgetMs: 2_000});
        await harness.manager.connectUnconnected();
        const signal = new AbortController().signal;
        const missing = asResult(await harness.manager.callTool("no-such-server", "read", {}, signal), "missing");
        assert.ok(!missing.ok);
        assert.equal(missing.error.kind, "protocol");
        const unsupported = asResult(await harness.manager.callTool("stdio-server", "read", {}, signal), "unsupported");
        assert.ok(!unsupported.ok);
        assert.equal(unsupported.error.action, "fix-config");
        assert.ok(unsupported.error.detail.includes("暂不支持 stdio"));
        const disabled = asResult(await harness.manager.callTool("off-server", "read", {}, signal), "disabled");
        assert.ok(!disabled.ok);
        assert.ok(disabled.error.detail.includes("已停用"));
        assert.equal(harness.countOf("stdio-server", "initialize"), 0);
        assert.equal(harness.countOf("off-server", "initialize"), 0);
    });
});
