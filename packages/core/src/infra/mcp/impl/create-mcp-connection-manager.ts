/**
 * MCP 连接管理器（spec §五 / Step 8 / Step 11）：懒连接、失败隔离、serverStatuses
 * 同步读、快照 TTL 与 invalidate、单请求超时、装配期单 server 预算到点收割。
 *
 * 实现形态（spec §五）：`McpConnectionManagerFactory.create(deps)` 返回持有连接
 * Map 与快照缓存的闭包对象，不写顶层 Map 加自由函数。server 级失败只能从
 * `serverStatuses()` 读出（`snapshotTools()` 对失败的 server 只是跳过）：
 * - `disabled` / `unsupported`（stdio / sse 只归一不实现，Step 11）无连接态，
 *   两个方法里现算；
 * - `ready` / `failed` / `pending` 记在 {@link McpConnectionEntry.status}；
 *   同快照 slug 复合名撞名的 server 也标 `failed`（spec §六：`failed{protocol,
 *   report}`，markSlugConflicts 在 snapshotTools 聚合出口检测并剔除涉事条目）。
 *
 * 单请求超时走官方 `RequestOptions.timeout`（= `timeoutMs`）；装配期预算
 * min(timeoutMs, 8000) 到点 abort 预算 signal，AbortRelayTransport 把它并进
 * requestSignal、请求函数适配层据此调 requestAbort 真断连（core 不直接持有
 * requestAbort）。callTool 对 AbortError 原样 reject 透传（取消不进 Result）。
 *
 * @module infra/mcp/impl/create-mcp-connection-manager
 */

import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import { AbortError } from "@/domain/abort/logic/create-abort-error.js";
import { McpFailureClassifier } from "@/domain/mcp/logic/classify-mcp-failure.js";
import { McpToolSlug } from "@/domain/mcp/logic/slugify-mcp-tool-name.js";
import { McpFailureOps, type McpFailure } from "@/domain/mcp/model/mcp-failure.js";
import { McpServerConfigOps, type McpServerConfig } from "@/domain/mcp/model/mcp-server-config.js";
import type { McpServerStatus, McpToolSnapshot } from "@/domain/mcp/model/mcp-tool-snapshot.js";
import type { McpConnectionManager } from "@/domain/mcp/ports/mcp-connection.port.js";
import { Result } from "@/errors/either.js";
import { RequestAbort } from "@/infra/llm-protocol/logic/request-abort.js";
import { OfficialMcpClient } from "@/infra/mcp/impl/official-mcp-client.js";
import { McpTransportError, type McpRequestFn } from "@/infra/mcp/ports/mcp-transport.port.js";

/** 快照 TTL（spec §五：60s 到期或 invalidate 失效，只有这两条路径）。 */
const MCP_SNAPSHOT_TTL_MS = 60_000;

/** 装配期单 server 预算上限（spec §五：单个 server 最多等 min(timeoutMs, 8000)，到点收割在途请求）。 */
const MCP_ASSEMBLY_BUDGET_MS = 8_000;

/** 单 server 的连接与快照缓存条目（client 为 null 表示无可用连接；snapshotAt 为 0 表示从未成功快照）。 */
interface McpConnectionEntry {
    client: OfficialMcpClient | null;
    snapshots: readonly McpToolSnapshot[];
    snapshotAt: number;
    status: McpServerStatus;
    inflight: Promise<readonly McpToolSnapshot[]> | null;
}

/**
 * 连接管理器装配依赖。`listServers` / `bearerToken` 是最窄读接缝：装配层（双端
 * runtime）从 config store 与 SKSP 接线，本模块不依赖 config store 实现（同波次
 * 并行开发）；`now` / `assemblyBudgetMs` 是测试注入点（生产用 Date.now / 8000）。
 */
export interface McpConnectionManagerDeps {
    /** 归一配置列表（每次调用现读，配置变更无需通知）。 */
    readonly listServers: () => readonly McpServerConfig[];
    /** 双端共享请求函数（桌面 fetch / 移动原生 request 适配）。 */
    readonly requestFn: McpRequestFn;
    /** SKSP 读 bearer 明文（`mcp/{serverId}/bearer` 的 secretRef → token；读失败按无 token 处理）。 */
    readonly bearerToken: (secretRef: string) => Promise<string | null>;
    /** 某 server 被用户关掉的工具名清单（配置页每工具开关）；快照出口过滤，被关的工具不注册进 agent。 */
    readonly disabledTools: (serverId: string) => readonly string[];
    /** 时钟（TTL 判定与 lastConnectedAt）；缺省 Date.now。 */
    readonly now?: () => number;
    /** 装配期单 server 预算上限（生产固定 8000；测试注入小值）。 */
    readonly assemblyBudgetMs?: number;
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

/** nm-style: keep-public — spec §五指定的装配形态（McpConnectionManagerFactory.create(deps)）；生产消费在 Step 9 的 run-agent-turn 装配与双端 runtime（后续波次接线），本波次仅测试可达。 */
export const McpConnectionManagerFactory = {
    /** 创建持有连接 Map 与快照缓存的闭包对象（spec §五实现形态：状态在闭包，不写顶层 Map）。 */
    create: (deps: McpConnectionManagerDeps): McpConnectionManager => {
        const now = deps.now ?? (() => Date.now());
        const budgetCeiling = deps.assemblyBudgetMs ?? MCP_ASSEMBLY_BUDGET_MS;
        const connections = new Map<string, McpConnectionEntry>();
        const connecting = new Map<string, Promise<Result<OfficialMcpClient, ConnectFailure>>>();
        /** 按 server 的代际：invalidate / closeAll 递增，在途结果写回前校验——代际已变即属于旧配置，丢弃。 */
        const generations = new Map<string, number>();
        // nm-style: keep-local — 闭包内被 connectOnce / fetchSnapshot / callTool / invalidate / closeAll 共用（闭包内引用按名计数看不到）
        const generationOf = (serverId: string): number => generations.get(serverId) ?? 0;
        // nm-style: keep-local — 闭包内三处在途路径共用的代际校验（闭包内引用按名计数看不到）
        const isStale = (serverId: string, generation: number): boolean => generationOf(serverId) !== generation;
        // nm-style: keep-local — 闭包内 connectOnce / fetchSnapshot 两处丢弃路径共用（闭包内引用按名计数看不到）
        const closeClient = async (client: OfficialMcpClient | null): Promise<void> => {
            if (client !== null) await client.close().catch(() => undefined);
        };

        /** 把可能失败的 Promise 收成 Result：抛出物原样进 Err，不在这里重抛（是不是取消、算哪类失败由调用方按场景判）。 */
        // nm-style: keep-local — 闭包内被 connectOnce / fetchSnapshot / callTool 三处共用（闭包内引用按名计数看不到）
        const settlePromise = async <T>(pending: Promise<T>): Promise<Result<T, unknown>> => pending.then((value) => Result.ok<T>(value), (error: unknown) => Result.err<unknown>(error));
        // nm-style: keep-local — 闭包内 connectOnce 的两处「底层抛出物 → 建连失败原因」共用
        const asConnectResult = (outcome: Result<OfficialMcpClient, unknown>): Result<OfficialMcpClient, ConnectFailure> => (outcome.ok ? Result.ok(outcome.value) : Result.err({ kind: "error", error: outcome.error }));

        /**
         * nm-style: keep-local — single-flight 建连，直接读写 connecting/connections 闭包状态。
         * 并行 callTool / 快照拉取共享同一次握手；首个调用者的 signal 约束连接（中止即
         * AbortError reject + requestSignal 收割）；共享同一 inflight 的后来者只共享
         * promise——它的 signal 中止要等握手自身了结后才体现（真实部署里连接在装配期
         * 已建立，此窗口仅在装配 pending 后首调出现）。
         */
        const connectOnce = async (config: McpServerConfig, signal: AbortSignal): Promise<Result<OfficialMcpClient, ConnectFailure>> => {
            const generation = generationOf(config.id);
            const held = connections.get(config.id)?.client;
            if (held != null) return Result.ok(held);
            const inflight = connecting.get(config.id);
            if (inflight !== undefined) return inflight;
            const pending = (async (): Promise<Result<OfficialMcpClient, ConnectFailure>> => {
                if (config.transport.type !== "http") return Result.err({ kind: "failure", failure: McpFailureOps.unsupportedTransport(config.transport.type) });
                // bearer 密钥读失败按无 token 处理（SKSP 故障不断连，服务器 401 会归 auth）。
                let authToken: string | null = null;
                if (config.auth.type === "bearer") {
                    try {
                        authToken = await deps.bearerToken(config.auth.secretRef);
                    } catch {
                        authToken = null;
                    }
                }
                return settlePromise(OfficialMcpClient.connect({ url: config.transport.url, requestFn: deps.requestFn, authToken, timeoutMs: config.timeoutMs }, signal)).then(asConnectResult);
            })();
            connecting.set(config.id, pending);
            // 成功失败都清掉自己登记的那一条：invalidate 之后新一代可能已登记新的在途握手。
            const outcome = await pending.finally(() => {
                if (connecting.get(config.id) === pending) connecting.delete(config.id);
            });
            if (!outcome.ok) return outcome;
            const client = outcome.value;
            if (isStale(config.id, generation)) {
                await closeClient(connections.get(config.id)?.client === client ? null : client);
                return Result.err({ kind: "failure", failure: { kind: "network", action: "retry", detail: `MCP 服务器 ${config.id} 的连接已被更新的配置取代` } });
            }
            const settled = connections.get(config.id);
            // 快照拉取已先行登记「连接中」条目时只补 client，不覆盖其状态。
            if (settled == null) connections.set(config.id, { client, snapshots: [], snapshotAt: 0, status: { serverId: config.id, state: "ready", lastConnectedAt: now() }, inflight: null });
            else if (settled.client == null) connections.set(config.id, { ...settled, client });
            return Result.ok(client);
        };

        /** nm-style: keep-local — 直接读写 connections 闭包状态（快照条目），是连接状态机的组成部分。单 server 快照拉取：全程受装配预算约束（connect + listTools），失败记状态并返回空，不拖累其他 server。 */
        const fetchSnapshot = async (config: McpServerConfig, holder: { inflight: Promise<readonly McpToolSnapshot[]> | null }): Promise<readonly McpToolSnapshot[]> => {
            const generation = generationOf(config.id);
            const budgetMs = Math.min(config.timeoutMs, budgetCeiling);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), budgetMs);
            // nm-style: keep-local — 闭包内 fetchSnapshot 的两条失败路径（握手、tools/list）共用的状态收口，直接读写 connections。
            const failWith = async (reason: ConnectFailure, client: OfficialMcpClient | null): Promise<readonly McpToolSnapshot[]> => {
                if (isStale(config.id, generation)) return [];
                const timedOut = controller.signal.aborted || (reason.kind === "error" && RequestAbort.isAbortLikeError(reason.error));
                // 一次尝试到此即 failed（预算内未完成，或握手 / tools/list 出错）：界面不自动重试，重试入口是「测试连接」与装配期。
                let failure: McpFailure;
                if (timedOut) {
                    failure = { kind: "network", action: "retry", detail: `装配期 ${budgetMs}ms 预算内未完成连接与 tools/list，已中止在途请求` };
                } else if (reason.kind === "failure") {
                    failure = reason.failure;
                } else {
                    failure = failureOf(config, reason.error);
                }
                connections.set(config.id, { client: timedOut ? client : null, snapshots: [], snapshotAt: 0, status: { serverId: config.id, state: "failed", failure }, inflight: holder.inflight });
                return [];
            };
            try {
                let client: OfficialMcpClient | null = connections.get(config.id)?.client ?? null;
                if (client === null) {
                    const connected = await connectOnce(config, controller.signal);
                    if (!connected.ok) return await failWith(connected.error, null);
                    client = connected.value;
                }
                const listed = await settlePromise(client.listTools(controller.signal));
                if (!listed.ok) return await failWith({ kind: "error", error: listed.error }, client);
                if (isStale(config.id, generation)) {
                    await closeClient(client);
                    return [];
                }
                const snapshots = listed.value.map((tool) => ({ serverId: config.id, toolName: tool.name, ...(tool.description === undefined ? {} : {toolDescription: tool.description}) }));
                const snapshotAt = now();
                connections.set(config.id, { client, snapshots, snapshotAt, status: { serverId: config.id, state: "ready", toolCount: snapshots.length, lastConnectedAt: snapshotAt }, inflight: holder.inflight });
                return snapshots;
            } finally {
                clearTimeout(timer);
            }
        };

        /** nm-style: keep-local — 直接读写 connections 闭包状态（TTL 判定、inflight single-flight、快照缓存），是连接状态机的入口分发。 */
        const snapshotFor = (config: McpServerConfig): Promise<readonly McpToolSnapshot[]> => {
            if (!config.enabled || !McpServerConfigOps.isTransportSupported(config)) return Promise.resolve([]);
            const entry = connections.get(config.id);
            if (entry !== undefined && entry.snapshotAt > 0 && now() - entry.snapshotAt < MCP_SNAPSHOT_TTL_MS) return Promise.resolve(entry.snapshots);
            if (entry?.inflight != null) return entry.inflight;
            const holder = { inflight: null as Promise<readonly McpToolSnapshot[]> | null };
            const inflight = fetchSnapshot(config, holder).finally(() => {
                const current = connections.get(config.id);
                if (current?.inflight === inflight) current.inflight = null;
            });
            holder.inflight = inflight;
            // 连接中状态与在途 promise 同步落表：连点开关、反复进列表都共享同一次尝试。
            const previous = entry ?? { client: null, snapshots: [] as readonly McpToolSnapshot[], snapshotAt: 0 };
            connections.set(config.id, { client: previous.client, snapshots: previous.snapshots, snapshotAt: previous.snapshotAt, status: { serverId: config.id, state: "connecting" }, inflight });
            return inflight;
        };

        /**
         * nm-style: keep-local — 直接读写 connections 闭包状态（status 覆写），是
         * 连接状态机的收尾一步。spec §六：同一快照内 slug 复合名撞名（含单 server
         * 内重名与跨 server id 归一撞名）时，涉事 server 标 `failed{protocol,
         * report}` 并从返回快照剔除其全部条目——server 级失败只能从 `serverStatuses()`
         * 读出（spec §五），不写状态 UI 就读不到，agent 里却一个工具都没有。TTL
         * 缓存条目（client / snapshots / snapshotAt）原样保留：撞名是注册名冲突不是
         * 连接故障，重置会破坏「子 run 复用快照不重复 tools/list」；检测在每次聚合
         * 出口幂等重跑，状态与剔除结果稳定。
         */
        const markSlugConflicts = (snapshot: readonly McpToolSnapshot[]): readonly McpToolSnapshot[] => {
            const byName = new Map<string, readonly McpToolSnapshot[]>();
            for (const entry of snapshot) {
                const name = McpToolSlug.toolName(entry.serverId, entry.toolName);
                byName.set(name, [...(byName.get(name) ?? []), entry]);
            }
            const conflicts = [...byName].filter(([, group]) => group.length > 1);
            if (conflicts.length === 0) return snapshot;
            const conflictingServers = new Set(conflicts.flatMap(([, group]) => group.map((entry) => entry.serverId)));
            for (const serverId of conflictingServers) {
                const detail = conflicts.filter(([, group]) => group.some((entry) => entry.serverId === serverId)).map(([name, group]) => `${group.map((entry) => `${entry.serverId}:${entry.toolName}`).join(" / ")} 归一为同名注册名 ${name}`).join("；");
                const entry = connections.get(serverId);
                connections.set(serverId, { client: entry?.client ?? null, snapshots: entry?.snapshots ?? [], snapshotAt: entry?.snapshotAt ?? 0, status: { serverId, state: "failed", failure: { kind: "protocol", action: "report", detail: `工具注册名冲突：${detail}；涉事 server 的工具本轮不注册` } }, inflight: entry?.inflight ?? null });
            }
            return snapshot.filter((entry) => !conflictingServers.has(entry.serverId));
        };

        /** nm-style: keep-public — McpConnectionManager port 契约的实现方法；生产消费在 Step 9 的 run-agent-turn 装配与双端 runtime/catalog（后续波次接线），本波次仅测试可达。 */
        const snapshotTools = async (): Promise<readonly McpToolSnapshot[]> => {
            const batches = await Promise.all(deps.listServers().map(snapshotFor));
            return markSlugConflicts(batches.flat().filter((entry) => !deps.disabledTools(entry.serverId).includes(entry.toolName)));
        };

        /** nm-style: keep-public — McpConnectionManager port 契约的实现方法；双端状态标签与「测试连接」的唯一读取面，生产消费在后续波次接线。 */
        const serverStatuses = (): readonly McpServerStatus[] => deps.listServers().map((config) => {
            if (!config.enabled) return { serverId: config.id, state: "disabled" };
            if (!McpServerConfigOps.isTransportSupported(config)) return { serverId: config.id, state: "unsupported", failure: McpFailureOps.unsupportedTransport(config.transport.type) };
            return connections.get(config.id)?.status ?? { serverId: config.id, state: "pending" };
        });

        /** callTool 的失败收口。取消是控制流不是失败：AbortError 原样往上抛（signal 已中止时官方可能包成 SdkError，兜底转回 AbortError）。 */
        // nm-style: keep-local — 闭包内 callTool 的两条失败路径（握手、tools/call）共用的状态收口，直接读写 connections。
        const failCall = (config: McpServerConfig, generation: number, signal: AbortSignal, reason: ConnectFailure): Result<unknown, McpFailure> => {
            const error = reason.kind === "error" ? reason.error : null;
            if (error != null && (RequestAbort.isAbortLikeError(error) || signal.aborted)) {
                // nm-throw: keep — 不是平台契约，是工具系统当前的取消通道（技术债）：Tool.run 只返回 Result、tool-runner 用 Promise.race 竞速取消，取消只能以 AbortError 形态到达；这里原样透传给 to-nm-tool 转成 TOOL_CANCELLED。工具系统迁到 Interrupt / Outcome 后这里随之改成返回值
                throw RequestAbort.isAbortLikeError(error) ? error : AbortError.create();
            }
            const failure = reason.kind === "failure" ? reason.failure : failureOf(config, reason.error);
            // 期间 invalidate / closeAll 过：这次失败属于旧配置，不写回状态。
            if (isStale(config.id, generation)) return Result.err(failure);
            const entry = connections.get(config.id);
            connections.set(config.id, { client: entry?.client ?? null, snapshots: entry?.snapshots ?? [], snapshotAt: entry?.snapshotAt ?? 0, status: { serverId: config.id, state: "failed", failure }, inflight: entry?.inflight ?? null });
            return Result.err(failure);
        };

        const callTool = async (serverId: string, toolName: string, args: unknown, signal: AbortSignal): Promise<Result<unknown, McpFailure>> => {
            const config = deps.listServers().find((server) => server.id === serverId);
            if (config === undefined) return Result.err({ kind: "protocol", action: "report", detail: `MCP 服务器 ${serverId} 不在当前配置中` });
            if (!config.enabled) return Result.err({ kind: "server", action: "fix-config", detail: `MCP 服务器 ${config.id} 已停用` });
            if (!McpServerConfigOps.isTransportSupported(config)) return Result.err(McpFailureOps.unsupportedTransport(config.transport.type));
            const generation = generationOf(config.id);
            const connected = await connectOnce(config, signal);
            if (!connected.ok) return failCall(config, generation, signal, connected.error);
            const called = await settlePromise(connected.value.callTool(toolName, args, signal));
            return called.ok ? Result.ok(called.value) : failCall(config, generation, signal, { kind: "error", error: called.error });
        };

        /** nm-style: keep-public — McpConnectionManager port 契约的实现方法（配置保存/手动刷新的失效入口）：递增代际让在途结果作废，再清表。生产消费在后续波次接线。 */
        const invalidate = (serverId: string): void => {
            generations.set(serverId, generationOf(serverId) + 1);
            connections.delete(serverId);
            connecting.delete(serverId);
        };

        /** nm-style: keep-public — McpConnectionManager port 契约的实现方法（应用退出时关闭常驻连接）；直接读写 connections 闭包状态。 */
        const closeAll = async (): Promise<void> => {
            const clients = [...connections.values()].flatMap((entry) => (entry.client === null ? [] : [entry.client]));
            for (const serverId of new Set([...connections.keys(), ...generations.keys()])) generations.set(serverId, generationOf(serverId) + 1);
            connections.clear();
            connecting.clear();
            await Promise.allSettled(clients.map((client) => client.close()));
        };

        return { snapshotTools, serverStatuses, callTool, invalidate, closeAll };
    },
} as const;
