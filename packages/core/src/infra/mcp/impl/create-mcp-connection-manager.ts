/**
 * MCP 连接管理器（总体方案 B/C）：连接状态机（pending / connecting / ready /
 * disconnected / failed / disabled / unsupported）、统一「连接」内部步骤、读取口
 * 撞名检测、调用时按原始错误重连一次重试一次。
 *
 * 实现形态（总体方案 C）：`McpConnectionManagerFactory.create(deps)` 返回持有
 * 连接条目 Map 的闭包对象，不写顶层 Map。server 级失败只能从 `serverStatuses()`
 * 读出（`cachedTools()` 对失败、撞名与从未连上的 server 只是跳过）：
 * - `disabled` / `unsupported`（stdio / sse 只归一不实现）无连接条目，读取面现算；
 * - 其余状态记在 {@link McpConnectionEntry.status}；撞名 server 也标 `failed`
 *   （`failed{protocol, report}`，缓存条目保留，检测在 cachedTools /
 *   serverStatuses 两个读取口同步执行）。
 *
 * 「连接」= 握手 + tools/list，三个入口（connectUnconnected / connect / 调用时
 * 重连）共用同一步骤；每个入口进入时取代际、写回前校验（沿用代际守卫）。
 * 「连接中」在该步骤首个 await 之前同步落表，重复触发共享一次尝试。没有 TTL：
 * 工具缓存只在连接成功时整体替换。
 *
 * 三条既定规则保留：连接中状态同步落表；代际守卫（invalidate / closeAll / 更新的
 * connect 之后在途结果不写回）；取消是控制流，不写连接状态（唯一例外：取消落在
 * 调用自己发起的重连握手期间 → disconnected，总体方案 C 节）。
 *
 * 单请求超时走官方 `RequestOptions.timeout`（= `timeoutMs`）；连接预算
 * min(timeoutMs, connectBudgetMs) 到点 abort 预算 signal，AbortRelayTransport
 * 把它并进 requestSignal、请求函数适配层据此调 requestAbort 真断连。callTool 的
 * 取消沿 Interrupt.cancelled 返回。
 *
 * @module infra/mcp/impl/create-mcp-connection-manager
 */

import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import { assert } from "@/common/assert.js";
import { Guards } from "@/common/guards.js";
import { McpFailureClassifier } from "@/domain/mcp/logic/classify-mcp-failure.js";
import { McpToolSlug } from "@/domain/mcp/logic/slugify-mcp-tool-name.js";
import { McpFailureOps, type McpFailure } from "@/domain/mcp/model/mcp-failure.js";
import { McpServerConfigOps, type McpServerConfig } from "@/domain/mcp/model/mcp-server-config.js";
import type { McpServerStatus, McpToolSnapshot } from "@/domain/mcp/model/mcp-tool-snapshot.js";
import type { McpConnectionManager } from "@/domain/mcp/ports/mcp-connection.port.js";
import { Result } from "@/errors/either.js";
import type { Interrupt } from "@/errors/outcome.js";
import { RequestAbort } from "@/infra/llm-protocol/logic/request-abort.js";
import { OfficialMcpClient } from "@/infra/mcp/impl/official-mcp-client.js";
import { McpTransportError, type McpRequestFn } from "@/infra/mcp/ports/mcp-transport.port.js";

/** 单 server 连接预算上限（总体方案 C：只约束「连接」这一步，生产 8000；测试注入小值）。 */
const MCP_CONNECT_BUDGET_MS = 8_000;

/** 单 server 的连接与缓存条目（client 为 null 表示无可用连接；heldSession = 最近一次采样到服务器下发的会话编号非空）。 */
interface McpConnectionEntry {
    client: OfficialMcpClient | null;
    snapshots: readonly McpToolSnapshot[];
    status: McpServerStatus;
    heldSession: boolean;
    inflight: Promise<Result<OfficialMcpClient, ConnectFailure>> | null;
}

/**
 * 连接管理器装配依赖。`listServers` / `bearerToken` 是最窄读接缝：装配层（双端
 * runtime）从 config store 与 SKSP 接线，本模块不依赖 config store 实现（同波次
 * 并行开发）；`now` / `connectBudgetMs` 是测试注入点（生产用 Date.now / 8000，
 * 预算只约束「连接」这一步）。
 */
export interface McpConnectionManagerDeps {
    /** 归一配置列表（每次调用现读，配置变更无需通知）。 */
    readonly listServers: () => readonly McpServerConfig[];
    /** 双端共享请求函数（桌面 fetch / 移动原生 request 适配）。 */
    readonly requestFn: McpRequestFn;
    /** SKSP 读 bearer 明文（`mcp/{serverId}/bearer` 的 secretRef → token；读失败按无 token 处理）。 */
    readonly bearerToken: (secretRef: string) => Promise<string | null>;
    /** 某 server 被用户关掉的工具名清单（配置页每工具开关）；读取口的工具过滤与撞名检测共用。 */
    readonly disabledTools: (serverId: string) => readonly string[];
    /** 时钟（lastConnectedAt）；缺省 Date.now。 */
    readonly now?: () => number;
    /** 单 server 连接预算上限（生产固定 8000；测试注入小值）。 */
    readonly connectBudgetMs?: number;
}

/** auth 失败的 action 按 server 鉴权配置细化（bearer → fix-config，其余 → reauthorize；spec §四固定映射的收尾一步）。 */
const withAuthAction = (config: McpServerConfig, failure: McpFailure): McpFailure => ({...failure, action: McpFailureClassifier.actionForKind(failure.kind, config.auth.type)});

/** 任意错误 → McpFailure：transport 错误里没有响应的（网络层失败）直接归 network / retry，有响应的按 raw 四层分类；官方超时归 network/retry；其余按文本归 unknown。 */
const failureOf = (config: McpServerConfig, error: unknown): McpFailure => {
    if (error instanceof McpTransportError) {
        // 没有响应的（请求函数自身失败，如网络断开）直接归 network / retry；有响应的按 raw 四层分类。
        if (error.raw == null) return withAuthAction(config, { kind: "network", action: "retry", detail: error.message });
        return withAuthAction(config, McpFailureClassifier.classify({ status: error.raw.status, contentType: error.raw.contentType, body: error.raw.body ?? error.message, wwwAuthenticate: error.wwwAuthenticate }));
    }
    if (SdkError.isInstance(error)) {
        const kind = error.code === SdkErrorCode.RequestTimeout ? "network" : "protocol";
        return withAuthAction(config, { kind, action: kind === "network" ? "retry" : "report", detail: error.message });
    }
    return withAuthAction(config, McpFailureClassifier.classify({ body: error instanceof Error ? error.message : String(error) }));
};

/** 建连失败的两种原因：已归一的业务失败（传输类型不可连 / 被新配置取代），或底层的原始抛出物（由调用方按场景归一，取消与否也在这里判）。 */
type ConnectFailure = { readonly kind: "failure"; readonly failure: McpFailure } | { readonly kind: "error"; readonly error: unknown };

/** callTool 撞上在途握手时的共享等待结果：调用方 signal 中止即取消让路，否则拿到那次握手的结论。 */
type SharedHandshake = { readonly kind: "cancelled" } | { readonly kind: "settled"; readonly value: Result<OfficialMcpClient, ConnectFailure> };

/** 「连接」入口（总体方案 B）：失败落点与缓存保留策略按入口与起点区分——unconnected 从 pending 起点清缓存落 failed、从 disconnected 起点保留缓存保持 disconnected；explicit 一律 failed 清缓存；reconnect 保留缓存落 disconnected。 */
type ConnectEntrance = { readonly kind: "unconnected"; readonly fromPending: boolean } | { readonly kind: "explicit" } | { readonly kind: "reconnect" };

// nm-style: keep-public — spec 总体方案 C 指定的装配形态（McpConnectionManagerFactory.create(deps)）；生产消费在后续波次的装配（run-agent-turn）与双端 runtime 接线，本波次仅测试可达。
export const McpConnectionManagerFactory = {
    /** 创建持有连接条目 Map 的闭包对象（状态在闭包，不写顶层 Map）。 */
    create: (deps: McpConnectionManagerDeps): McpConnectionManager => {
        const now = deps.now ?? (() => Date.now());
        const budgetCeiling = deps.connectBudgetMs ?? MCP_CONNECT_BUDGET_MS;
        const connections = new Map<string, McpConnectionEntry>();
        /** 按 server 的代际：invalidate / closeAll / connect 递增，在途结果写回前校验——代际已变即属于旧配置，丢弃。调用时重连不递增（保留缓存写回的资格），靠校验与 invalidate 竞争。 */
        const generations = new Map<string, number>();
        /** 没有调用方 signal 的入口（connectUnconnected / connect）用它：只受连接预算约束。 */
        const neverSignal = new AbortController().signal;
        // nm-style: keep-local — 闭包内被统一连接步骤 / callTool / invalidate / closeAll 共用（闭包内引用按名计数看不到）
        const generationOf = (serverId: string): number => generations.get(serverId) ?? 0;
        // nm-style: keep-local — 闭包内三处在途路径共用的代际校验（闭包内引用按名计数看不到）
        const isStale = (serverId: string, generation: number): boolean => generationOf(serverId) !== generation;
        // nm-style: keep-local — 统一连接步骤的 stale 收尾与 closeAll 共用（闭包内引用按名计数看不到）
        const closeClient = async (client: OfficialMcpClient | null): Promise<void> => {
            if (client !== null) await client.close().catch(() => undefined);
        };
        /** 把可能失败的 Promise 收成 Result：抛出物原样进 Err，不在这里重抛（是不是取消、算哪类失败由调用方按场景判）。 */
        // nm-style: keep-local — 闭包内统一连接步骤与 callTool 共用（闭包内引用按名计数看不到）
        const settlePromise = async <T>(pending: Promise<T>): Promise<Result<T, unknown>> => pending.then((value) => Result.ok<T>(value), (error: unknown) => Result.err<unknown>(error));
        // nm-style: keep-local — 统一连接步骤的失败写回与 callTool 的共享握手失败、重连失败三处共用（闭包内引用按名计数看不到）
        const failureFrom = (config: McpServerConfig, reason: ConnectFailure): McpFailure => (reason.kind === "failure" ? reason.failure : failureOf(config, reason.error));

        /**
         * nm-style: keep-local — 统一「连接」步骤（握手 + tools/list），三个入口共用；
         * 直接读写 connections / generations 闭包状态。「连接中」在本函数体内首个
         * await 之前同步落表（调用方拿到 promise 时就能读到 connecting，且并发触发
         * 共享同一次尝试）；失败按入口与起点写回 failed（清缓存）或 disconnected
         * （保留缓存与 lastConnectedAt）；成功整体替换缓存并重新采样 heldSession。
         * 写回前校验代际：invalidate / closeAll / 更新的 connect 之后在途结果一律
         * 丢弃，丢弃时顺手关掉刚建好的 client，不泄漏连接。
         */
        const connectServer = (config: McpServerConfig, entrance: ConnectEntrance, signal: AbortSignal): Promise<Result<OfficialMcpClient, ConnectFailure>> => {
            // 三个入口都只对受支持的传输走到这里；这层检查是不可达防御，同步返回、不落任何连接条目。
            if (config.transport.type !== "http") return Promise.resolve(Result.err({kind: "failure", failure: McpFailureOps.unsupportedTransport(config.transport.type)}));
            const endpoint = config.transport;
            const generation = generationOf(config.id);
            const budgetMs = Math.min(config.timeoutMs, budgetCeiling);
            const keepCache = entrance.kind === "reconnect" || (entrance.kind === "unconnected" && !entrance.fromPending);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), budgetMs);
            // nm-style: keep-closure — add/removeEventListener 同引用不变量（注册与 finally 按同一引用移除），参数化后调用点仍需一层持引用闭包，纯搬家。
            const onCallerAbort = (): void => {
                controller.abort();
            };
            if (signal.aborted) controller.abort();
            else signal.addEventListener("abort", onCallerAbort);
            const replacedFailure = (): ConnectFailure => ({kind: "failure", failure: {kind: "network", action: "retry", detail: `MCP 服务器 ${config.id} 的连接已被更新的配置取代`}});
            const attempt = (async (): Promise<Result<OfficialMcpClient, ConnectFailure>> => {
                // 失败收口（spec Step 7 的 failWith）：先归一失败（预算到点与调用方中止都先按失败落表，「是不是用户取消」由调用方按 signal 再判），代际已变不写回，否则按入口与起点落 failed（清缓存）或 disconnected（保留缓存与 lastConnectedAt）。
                const failWith = (reason: ConnectFailure): Result<OfficialMcpClient, ConnectFailure> => {
                    const error = reason.kind === "error" ? reason.error : null;
                    const failure: McpFailure = error != null && RequestAbort.isAbortLikeError(error) ? {kind: "network", action: "retry", detail: signal.aborted ? "连接在完成前被中止" : `连接 ${budgetMs}ms 预算内未完成握手与 tools/list，已中止在途请求`} : failureFrom(config, reason);
                    if (isStale(config.id, generation)) return Result.err(reason);
                    const current = connections.get(config.id);
                    connections.set(config.id, {client: null, snapshots: keepCache ? current?.snapshots ?? [] : [], status: {serverId: config.id, state: keepCache ? "disconnected" : "failed", failure, ...(keepCache && current?.status.lastConnectedAt !== undefined ? {lastConnectedAt: current.status.lastConnectedAt} : {})}, heldSession: keepCache ? current?.heldSession ?? false : false, inflight: null});
                    return Result.err(reason);
                };
                // bearer 密钥读失败按无 token 处理（SKSP 故障不断连，服务器 401 会归 auth）。
                let authToken: string | null = null;
                if (config.auth.type === "bearer") {
                    try {
                        authToken = await deps.bearerToken(config.auth.secretRef);
                    } catch {
                        authToken = null;
                    }
                }
                const handshake = await settlePromise(OfficialMcpClient.connect({url: endpoint.url, requestFn: deps.requestFn, authToken, timeoutMs: config.timeoutMs}, controller.signal));
                if (!handshake.ok) return failWith({kind: "error", error: handshake.error});
                if (isStale(config.id, generation)) {
                    await closeClient(handshake.value);
                    return Result.err(replacedFailure());
                }
                const listed = await settlePromise(handshake.value.listTools(controller.signal));
                if (!listed.ok) return failWith({kind: "error", error: listed.error});
                if (isStale(config.id, generation)) {
                    await closeClient(handshake.value);
                    return Result.err(replacedFailure());
                }
                const snapshots = listed.value.map((tool) => ({serverId: config.id, toolName: tool.name, ...(tool.description === undefined ? {} : {toolDescription: tool.description}), ...(Guards.isRecord(tool.inputSchema) ? {inputSchema: tool.inputSchema} : {})}));
                const connectedAt = now();
                connections.set(config.id, {client: handshake.value, snapshots, status: {serverId: config.id, state: "ready", toolCount: snapshots.length, lastConnectedAt: connectedAt}, heldSession: handshake.value.sessionId() !== null, inflight: null});
                return Result.ok(handshake.value);
            })();
            // 「连接中」与在途 promise 同步落表（保留断开前的缓存、heldSession 与 lastConnectedAt）：连点开关、反复进列表、并发调用都共享同一次尝试。
            const previous = connections.get(config.id);
            connections.set(config.id, {client: null, snapshots: keepCache && previous != null ? previous.snapshots : [], status: {serverId: config.id, state: "connecting", ...(keepCache && previous?.status.lastConnectedAt !== undefined ? {lastConnectedAt: previous.status.lastConnectedAt} : {})}, heldSession: keepCache && previous != null ? previous.heldSession : false, inflight: attempt});
            return attempt.finally(() => {
                clearTimeout(timer);
                signal.removeEventListener("abort", onCallerAbort);
                const current = connections.get(config.id);
                if (current?.inflight === attempt) current.inflight = null;
            });
        };

        // nm-style: keep-local — serverStatuses 与 connect 的终态返回共用（闭包内引用按名计数看不到）
        const statusOfConfig = (config: McpServerConfig): McpServerStatus => {
            if (!config.enabled) return {serverId: config.id, state: "disabled"};
            if (!McpServerConfigOps.isTransportSupported(config)) return {serverId: config.id, state: "unsupported", failure: McpFailureOps.unsupportedTransport(config.transport.type)};
            return connections.get(config.id)?.status ?? {serverId: config.id, state: "pending"};
        };

        /**
         * nm-style: keep-local — 读取口（cachedTools / serverStatuses）共用的撞名检测，
         * 直接读写 connections。检测前先按 disabledTools 过滤（被用户关掉的工具不参与
         * 撞名）；涉事 server 两边一并标 `failed{protocol, report}`，缓存条目与
         * lastConnectedAt 保留（撞名是注册名冲突不是连接故障，恢复后不必重连）；
         * 冲突消失时清除标记并按连接是否还在恢复——条目的连接还在 → ready，已不在 →
         * disconnected（撞名只发生在有缓存的服务器上，不会恢复成别的）。检测同步扫
         * 内存，不联网。failed 且有缓存 ⟺ 撞名标记（其余 failed 写法都清缓存）。
         */
        const detectSlugConflicts = (): void => {
            const byName = new Map<string, McpToolSnapshot[]>();
            for (const [serverId, entry] of connections) {
                if (entry.snapshots.length === 0 || entry.status.state === "connecting") continue;
                const disabled = deps.disabledTools(serverId);
                for (const tool of entry.snapshots) {
                    if (disabled.includes(tool.toolName)) continue;
                    const name = McpToolSlug.toolName(serverId, tool.toolName);
                    byName.set(name, [...(byName.get(name) ?? []), tool]);
                }
            }
            const conflicts = [...byName].filter(([, group]) => group.length > 1);
            const conflictedServers = new Set(conflicts.flatMap(([, group]) => group.map((tool) => tool.serverId)));
            for (const [serverId, entry] of connections) {
                if (entry.snapshots.length === 0 || entry.status.state === "connecting") continue;
                const marked = entry.status.state === "failed";
                if (conflictedServers.has(serverId) === marked) continue;
                if (conflictedServers.has(serverId)) {
                    const detail = conflicts.filter(([, group]) => group.some((tool) => tool.serverId === serverId)).map(([name, group]) => `${group.map((tool) => `${tool.serverId}:${tool.toolName}`).join(" / ")} 归一为同名注册名 ${name}`).join("；");
                    connections.set(serverId, {...entry, status: {serverId, state: "failed", failure: {kind: "protocol", action: "report", detail: `工具注册名冲突：${detail}；涉事 server 的工具不注册`}, ...(entry.status.lastConnectedAt === undefined ? {} : {lastConnectedAt: entry.status.lastConnectedAt})}});
                } else {
                    const restored = entry.client != null ? "ready" : "disconnected";
                    connections.set(serverId, {...entry, status: {serverId, state: restored, ...(restored === "ready" ? {toolCount: entry.snapshots.length} : {}), ...(entry.status.lastConnectedAt === undefined ? {} : {lastConnectedAt: entry.status.lastConnectedAt})}});
                }
            }
        };

        /**
         * nm-style: keep-public — McpConnectionManager port 契约的实现方法（装配与
         * 双端目录读取面）：同步读缓存，读取前先跑撞名检测。生产消费在后续波次接线，
         * 本波次仅测试可达。
         */
        const cachedTools = (): readonly McpToolSnapshot[] => {
            detectSlugConflicts();
            const tools: McpToolSnapshot[] = [];
            for (const config of deps.listServers()) {
                if (!config.enabled || !McpServerConfigOps.isTransportSupported(config)) continue;
                const entry = connections.get(config.id);
                // 只返回「启用、传输受支持、未撞名、未处于 failed」服务器的工具；connecting 期间保留旧缓存继续可用。
                if (entry === undefined || entry.snapshots.length === 0 || entry.status.state === "failed") continue;
                const disabled = deps.disabledTools(config.id);
                tools.push(...entry.snapshots.filter((tool) => !disabled.includes(tool.toolName)));
            }
            return tools;
        };

        /**
         * nm-style: keep-public — McpConnectionManager port 契约的实现方法（进页面
         * 触发）：只看本地状态，pending / disconnected 并发发起后台连接，其余不动
         * （connecting 撞上的进行中尝试也算进返回时机）。永不 reject。生产消费在
         * 后续波次的聊天页 / 启动接线，本波次仅测试可达。
         */
        const connectUnconnected = async (): Promise<void> => {
            const attempts: Promise<unknown>[] = [];
            for (const config of deps.listServers()) {
                if (!config.enabled || !McpServerConfigOps.isTransportSupported(config)) continue;
                const entry = connections.get(config.id);
                const state = entry?.status.state ?? "pending";
                if (state === "connecting") {
                    if (entry?.inflight != null) attempts.push(entry.inflight);
                    continue;
                }
                if (state === "pending" || state === "disconnected") attempts.push(connectServer(config, {kind: "unconnected", fromPending: state === "pending"}, neverSignal));
            }
            await Promise.allSettled(attempts);
        };

        /**
         * nm-style: keep-public — McpConnectionManager port 契约的实现方法（显式动作：
         * 开关打开 / 保存 / 测试连接 / 授权成功）：作废前先关掉旧连接（不等待关闭
         * 完成），一律先作废再全新连接，等结果并返回终态状态。
         */
        const connect = async (serverId: string): Promise<McpServerStatus> => {
            const config = deps.listServers().find((server) => server.id === serverId);
            // serverId 不在配置里属不变量破坏（总体方案 C）：编程错误走 assert，不占产品错误码。
            assert(config !== undefined, `MCP 服务器 ${serverId} 不在当前配置中`);
            if (!config.enabled || !McpServerConfigOps.isTransportSupported(config)) return statusOfConfig(config);
            const previous = connections.get(config.id);
            if (previous?.client != null) void previous.client.close().catch(() => undefined);
            generations.set(config.id, generationOf(config.id) + 1);
            connections.delete(config.id);
            await connectServer(config, {kind: "explicit"}, neverSignal);
            return statusOfConfig(config);
        };

        /**
         * nm-style: keep-public — McpConnectionManager port 契约的实现方法；双端状态
         * 标签与「测试连接」的唯一读取面，读取前先跑撞名检测。生产消费在后续波次接线，
         * 本波次仅测试可达。
         */
        const serverStatuses = (): readonly McpServerStatus[] => {
            detectSlugConflicts();
            return deps.listServers().map(statusOfConfig);
        };

        // nm-style: keep-local — callTool 两处重连失败（起点重连、调用失败后的重连）共用的收尾：重连握手被调用方 signal 中止算取消（状态已由连接步骤写回 disconnected），其余按失败返回。
        const reconnectOutcome = (config: McpServerConfig, signal: AbortSignal, reason: ConnectFailure): Result<unknown, McpFailure> | Interrupt => {
            const error = reason.kind === "error" ? reason.error : null;
            if (error != null && (RequestAbort.isAbortLikeError(error) || signal.aborted)) return {kind: "cancelled", reason: "user-stop"};
            return Result.err(failureFrom(config, reason));
        };

        /**
         * nm-style: keep-public — McpConnectionManager port 契约的实现方法（调用入口）：
         * 按起点分流——pending / failed 不连接（状态不变，返回「未连接」）；connecting
         * 共享在途握手（不另起、不写状态）；ready 直呼；disconnected 先重连。调用遇
         * 连接级失败（无 HTTP 响应）或会话失效（404 且此前持有会话）按原始错误重连一次
         * 并重试一次；服务器报的错与单次请求超时原样返回，状态与缓存不变。取消是控制流，
         * 不写状态（唯一例外：取消落在本调用发起的重连握手期间 → disconnected）。
         */
        const callTool = async (serverId: string, toolName: string, args: unknown, signal: AbortSignal): Promise<Result<unknown, McpFailure> | Interrupt> => {
            const config = deps.listServers().find((server) => server.id === serverId);
            if (config === undefined) return Result.err({kind: "protocol", action: "report", detail: `MCP 服务器 ${serverId} 不在当前配置中`});
            if (!config.enabled) return Result.err({kind: "server", action: "fix-config", detail: `MCP 服务器 ${config.id} 已停用`});
            if (!McpServerConfigOps.isTransportSupported(config)) return Result.err(McpFailureOps.unsupportedTransport(config.transport.type));
            const entry = connections.get(config.id);
            const state = entry?.status.state ?? "pending";
            if (state === "pending" || state === "failed") return Result.err({kind: "unknown", action: "report", detail: `MCP 服务器 ${config.id} 未连接`});
            // 第一段：拿到可用连接。ready 直用；connecting 共享在途握手；disconnected 先重连。
            let client: OfficialMcpClient;
            if (entry?.client != null) {
                client = entry.client;
            } else if (state === "connecting" && entry?.inflight != null) {
                // 撞上别人发起的握手：只共享，不写状态——它按自己的结果写回，本调用不改。
                // 调用方 signal 中止即刻取消让路（握手自身继续，按它自己的结果落表）。
                const disposers: Array<() => void> = [];
                const cancelled = new Promise<{kind: "cancelled"}>((resolve) => {
                    const onAbort = (): void => resolve({kind: "cancelled"});
                    if (signal.aborted) onAbort();
                    else signal.addEventListener("abort", onAbort, {once: true});
                    disposers.push(() => signal.removeEventListener("abort", onAbort));
                });
                const outcome = await Promise.race([entry.inflight.then((value): SharedHandshake => ({kind: "settled", value}), (): SharedHandshake => ({kind: "cancelled"})), cancelled]);
                for (const dispose of disposers) dispose();
                // inflight 是 connectServer 的 promise、从不 reject，映射到 cancelled 的一支不可达，只为让 await 不引入异常通道。
                if (outcome.kind === "cancelled") return {kind: "cancelled", reason: "user-stop"};
                if (!outcome.value.ok) return Result.err(failureFrom(config, outcome.value.error));
                client = outcome.value.value;
            } else {
                const reconnected = await connectServer(config, {kind: "reconnect"}, signal);
                if (!reconnected.ok) return reconnectOutcome(config, signal, reconnected.error);
                client = reconnected.value;
            }
            // 第二段：执行调用。
            const called = await settlePromise(client.callTool(toolName, args, signal));
            if (called.ok) return Result.ok(called.value);
            if (RequestAbort.isAbortLikeError(called.error) || signal.aborted) return {kind: "cancelled", reason: "user-stop"};
            // 重连判据读原始错误，不读分类结果（总体方案 C）：①传输错误且没有 HTTP 响应；②404 且此前持有会话。
            // 官方单次请求超时（SdkError / RequestTimeout）两条都不满足，不重连——服务器可能仍在执行。
            const transportError = called.error instanceof McpTransportError ? called.error : null;
            const connectionLost = transportError !== null && transportError.raw == null;
            const sessionExpired = transportError?.raw?.status === 404 && client.sessionId() !== null;
            if (!connectionLost && !sessionExpired) return Result.err(failureOf(config, called.error));
            // 关掉旧连接（先采样 heldSession——close 会清掉会话编号）、保留缓存，重连一次并重试一次。
            const dying = connections.get(config.id);
            if (dying != null) connections.set(config.id, {...dying, heldSession: client.sessionId() !== null});
            void client.close().catch(() => undefined);
            const reconnected = await connectServer(config, {kind: "reconnect"}, signal);
            if (!reconnected.ok) return reconnectOutcome(config, signal, reconnected.error);
            const retried = await settlePromise(reconnected.value.callTool(toolName, args, signal));
            if (retried.ok) return Result.ok(retried.value);
            if (RequestAbort.isAbortLikeError(retried.error) || signal.aborted) return {kind: "cancelled", reason: "user-stop"};
            // 重试的调用又失败：按那次失败原样返回，不再第二次重连，状态保持 ready（缓存已被重连替换）。
            return Result.err(failureOf(config, retried.error));
        };

        /**
         * nm-style: keep-public — McpConnectionManager port 契约的实现方法（停用 / 删除 /
         * 换 ID 的作废入口）：递增代际让在途结果作废，作废前先关掉旧连接（不等待关闭
         * 完成），再清条目。不连接。
         */
        const invalidate = (serverId: string): void => {
            const previous = connections.get(serverId);
            if (previous?.client != null) void previous.client.close().catch(() => undefined);
            generations.set(serverId, generationOf(serverId) + 1);
            connections.delete(serverId);
        };

        /** nm-style: keep-public — McpConnectionManager port 契约的实现方法（应用退出时关闭常驻连接）；直接读写 connections 闭包状态。 */
        const closeAll = async (): Promise<void> => {
            const clients = [...connections.values()].flatMap((entry) => (entry.client === null ? [] : [entry.client]));
            for (const serverId of new Set([...connections.keys(), ...generations.keys()])) generations.set(serverId, generationOf(serverId) + 1);
            connections.clear();
            await Promise.allSettled(clients.map((client) => client.close()));
        };

        return {cachedTools, connectUnconnected, connect, serverStatuses, callTool, invalidate, closeAll};
    },
} as const;
