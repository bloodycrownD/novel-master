/**
 * MCP handler 单测专用 mock runtime（供 mcp-handlers-mock-hook.mjs 重定向）：
 * 不拉真实 SQLite / KKV / SKSP——内存 SecretStore / 配置 store / agent 注册表 /
 * 连接管理器，各用例经 `runtimeHolder.current` 装配后调 handler。
 *
 * 内存配置 store 的 rename 语义对齐 core 实现（新 id 撞名拒绝、SKSP 三 ref 先写新后清旧、
 * 返回 oauthMigrated=true），否则换 ID 编排（core `McpServerRename.withAfterStep`）的
 * 回滚链测不到真实顺序。
 *
 * @module test/mcp-handlers-mock-runtime
 */
import { AppError, Result } from "@novel-master/core/errors";
import type { McpServerConfig, McpServerStatus, McpToolSnapshot } from "@novel-master/core/mcp";

/** 内存 SecretStore：记录 set / delete 调用；`failSet` 置错时下一次 set 抛出（bearer 写入失败回滚用例）。 */
export function makeSecretStore(initial: Readonly<Record<string, string>> = {}): MockSecretStore {
    const store = new Map(Object.entries(initial));
    const calls: { sets: Array<{ ref: string; value: string }>; deletes: string[] } = { sets: [], deletes: [] };
    let failSet: Error | null = null;
    return {
        calls,
        armSetFailure: (cause: Error): void => {
            failSet = cause;
        },
        get: async (ref: string): Promise<string | null> => store.get(ref) ?? null,
        set: async (ref: string, value: string): Promise<void> => {
            calls.sets.push({ ref, value });
            if (failSet != null) {
                const cause = failSet;
                failSet = null;
                throw cause;
            }
            store.set(ref, value);
        },
        delete: async (ref: string): Promise<void> => {
            calls.deletes.push(ref);
            store.delete(ref);
        },
        has: async (ref: string): Promise<boolean> => store.has(ref),
        peek: (ref: string): string | undefined => store.get(ref),
    };
}

export interface MockSecretStore {
    readonly calls: { sets: Array<{ ref: string; value: string }>; deletes: string[] };
    armSetFailure(cause: Error): void;
    get(ref: string): Promise<string | null>;
    set(ref: string, value: string): Promise<void>;
    delete(ref: string): Promise<void>;
    has(ref: string): Promise<boolean>;
    peek(ref: string): string | undefined;
}

/** 内存配置 store：rename 的撞名拒绝与 SKSP 迁移顺序对齐 core 实现（回滚链的测试前提）。 */
export function makeConfigStore(secretStore: MockSecretStore): MockConfigStore {
    const servers: McpServerConfig[] = [];
    const disabled: Record<string, string[]> = {};
    return {
        servers,
        list: async () => Result.ok([...servers]),
        save: async (config) => {
            const index = servers.findIndex((server) => server.id === config.id);
            if (index >= 0) servers[index] = config;
            else servers.push(config);
            return Result.ok(undefined);
        },
        create: async (config) => {
            if (servers.some((server) => server.id === config.id)) return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: `MCP 服务器 ID 已存在: ${config.id}` }));
            servers.push(config);
            return Result.ok(undefined);
        },
        rename: async (oldId, config) => {
            if (servers.some((server) => server.id === config.id && server.id !== oldId)) return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: `新 ID 与其它服务器撞名: ${config.id}` }));
            const index = servers.findIndex((server) => server.id === oldId);
            if (index < 0) return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: `MCP 服务器不存在: ${oldId}` }));
            // SKSP 三 ref 先写新后清旧（core 同款顺序）；迁移写走的是 set——bearer 写入失败注入会在这里抛
            for (const tail of ["bearer", "headers", "oauth"] as const) {
                const migrated = await secretStore.get(`mcp/${oldId}/${tail}`);
                if (migrated != null) {
                    await secretStore.set(`mcp/${config.id}/${tail}`, migrated);
                    await secretStore.delete(`mcp/${oldId}/${tail}`);
                }
            }
            servers[index] = config;
            return Result.ok({ oauthMigrated: true });
        },
        remove: async (serverId) => {
            const index = servers.findIndex((server) => server.id === serverId);
            if (index >= 0) servers.splice(index, 1);
            return Result.ok(undefined);
        },
        listDisabledTools: async () => Result.ok({ ...disabled }),
        setToolDisabled: async (serverId, toolName, off) => {
            const names = new Set(disabled[serverId] ?? []);
            if (off) names.add(toolName);
            else names.delete(toolName);
            if (names.size === 0) delete disabled[serverId];
            else disabled[serverId] = [...names];
            return Result.ok(undefined);
        },
    };
}

export interface MockConfigStore {
    readonly servers: McpServerConfig[];
    list(): Promise<Result<readonly McpServerConfig[], AppError>>;
    save(config: McpServerConfig): Promise<Result<void, AppError>>;
    create(config: McpServerConfig): Promise<Result<void, AppError>>;
    rename(oldId: string, config: McpServerConfig): Promise<Result<{ oauthMigrated: boolean }, AppError>>;
    remove(serverId: string): Promise<Result<void, AppError>>;
    listDisabledTools(): Promise<Result<Record<string, string[]>, AppError>>;
    setToolDisabled(serverId: string, toolName: string, disabled: boolean): Promise<Result<void, AppError>>;
}

/** 内存 agent 注册表：`failUpsert` 置真时 upsert 返回 err（引用改写失败回滚用例）。 */
export function makeAgentRegistry(options: { readonly failUpsert?: boolean } = {}): MockAgentRegistry {
    const agents = new Map<string, AgentLike>();
    const upserts: string[] = [];
    return {
        agents,
        upserts,
        seed: (agentId, def) => agents.set(agentId, def),
        listAgentIds: async () => [...agents.keys()],
        get: async (agentId) => (agents.has(agentId) ? Result.ok(agents.get(agentId) as AgentLike) : Result.err(new AppError("INFRA_UNEXPECTED_ERROR", { detail: `agent 不存在: ${agentId}` }))),
        upsert: async (agentId, def) => {
            upserts.push(agentId);
            if (options.failUpsert === true) return Result.err(new AppError("INFRA_UNEXPECTED_ERROR", { detail: `agent 写回失败: ${agentId}` }));
            agents.set(agentId, def);
            return Result.ok(undefined);
        },
    };
}

/** agent 定义的窄形状（只保留注册表读写路径碰到的字段）。 */
export interface AgentLike {
    readonly name: string;
    readonly prompts: { readonly persist: readonly string[]; readonly dynamic: readonly string[] };
    readonly tools?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] };
}

export interface MockAgentRegistry {
    readonly agents: Map<string, AgentLike>;
    readonly upserts: string[];
    seed(agentId: string, def: AgentLike): void;
    listAgentIds(): Promise<readonly string[]>;
    get(agentId: string): Promise<Result<AgentLike, AppError>>;
    upsert(agentId: string, def: AgentLike): Promise<Result<void, AppError>>;
}

/** 内存连接管理器：记录缓存读取 / 进页连接 / 显式连接 / invalidate 的调用痕迹（对齐 core 端口成员）。 */
export function makeConnectionManager(cached: readonly McpToolSnapshot[] = []): MockConnectionManager {
    const calls = { cached: 0, connectUnconnected: 0, connect: [] as string[], invalidated: [] as string[] };
    return {
        calls,
        cachedTools: () => {
            calls.cached += 1;
            return cached;
        },
        connectUnconnected: async () => {
            calls.connectUnconnected += 1;
        },
        connect: async (serverId) => {
            calls.connect.push(serverId);
            return { serverId, state: "ready" };
        },
        serverStatuses: () => [],
        callTool: async () => Result.err(new AppError("INFRA_UNEXPECTED_ERROR", { detail: "mock 未实现 callTool" })),
        invalidate: (serverId) => {
            calls.invalidated.push(serverId);
        },
        closeAll: async () => undefined,
    };
}

export interface MockConnectionManager {
    readonly calls: { cached: number; connectUnconnected: number; connect: string[]; invalidated: string[] };
    cachedTools(): readonly McpToolSnapshot[];
    connectUnconnected(): Promise<void>;
    connect(serverId: string): Promise<McpServerStatus>;
    serverStatuses(): readonly McpServerStatus[];
    callTool(serverId: string, toolName: string, args: unknown, signal: AbortSignal): Promise<Result<unknown, AppError>>;
    invalidate(serverId: string): void;
    closeAll(): Promise<void>;
}

/** 内存 OAuth 双入口：start 回显 redirectUrl、handleCallback 直接成功（授权成功路径默认打通）。 */
export function makeMcpOAuth(): MockMcpOAuth {
    return {
        start: async (_serverId, redirectUrl) => Result.ok({ authorizeUrl: redirectUrl }),
        handleCallback: async () => Result.ok(undefined),
    };
}

export interface MockMcpOAuth {
    start(serverId: string, redirectUrl: string): Promise<Result<{ readonly authorizeUrl: string }, AppError>>;
    handleCallback(serverId: string, callback: { readonly code?: string; readonly state?: string; readonly error?: string }): Promise<Result<void, AppError>>;
}

/** fake runtime 形状（handler 只消费这四个成员 + mcpOAuth）。 */
export interface MockRuntime {
    readonly secretStore: MockSecretStore;
    readonly mcpConfig: MockConfigStore;
    readonly agentRegistry: MockAgentRegistry;
    readonly mcp: { readonly connectionManager: MockConnectionManager };
    readonly mcpOAuth: MockMcpOAuth;
}

/** 装配 fake runtime（servers 直接铺进内存 store）。 */
export function makeRuntime(options: { readonly secretStore?: MockSecretStore; readonly servers?: readonly McpServerConfig[]; readonly agentRegistry?: MockAgentRegistry; readonly connectionManager?: MockConnectionManager; readonly mcpOAuth?: MockMcpOAuth } = {}): MockRuntime {
    const secretStore = options.secretStore ?? makeSecretStore();
    const mcpConfig = makeConfigStore(secretStore);
    mcpConfig.servers.push(...(options.servers ?? []));
    return {
        secretStore,
        mcpConfig,
        agentRegistry: options.agentRegistry ?? makeAgentRegistry(),
        mcp: { connectionManager: options.connectionManager ?? makeConnectionManager() },
        mcpOAuth: options.mcpOAuth ?? makeMcpOAuth(),
    };
}

/** 单例槽：测试用例先装配再调 handler（hook 把真单例重定向到本模块）。 */
export const runtimeHolder: { current: MockRuntime | undefined } = { current: undefined };

export const DesktopRuntimeSingleton = {
    get: async (): Promise<Result<MockRuntime, AppError>> => {
        if (runtimeHolder.current == null) return Result.err(new AppError("INFRA_UNEXPECTED_ERROR", { detail: "测试 runtime 未装配" }));
        return Result.ok(runtimeHolder.current);
    },
};
