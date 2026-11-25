/**
 * MCP 接入的 mobile 装配切片（spec mcp-support Step 13/14）。
 *
 * core 的 `McpConnectionManagerDeps.listServers` 是同步读接缝而 KKV 是异步读，
 * 所以配置走一层内存镜像：装配期读一次 `nm-mcp/servers` 进闭包，写路径
 * （save / create / rename / setEnabled / remove）落库后同步刷新镜像并 invalidate
 * 对应 server 的连接与快照缓存（spec §五：配置保存是快照失效的两条路径之一）。
 * 镜像的 `servers()` 就是连接管理器与 OAuth 工厂注入的 listServers。
 *
 * per-server 工具启停存 KKV `nm-mcp/disabledTools`（`{serverId: string[]}`），
 * 连接管理器的 `snapshotTools()` 在镜像出口按禁用清单过滤——run 装配期
 * （core `AgentTurnRuntimePort.mcp`）与配置页工具卡消费同一份过滤后快照，
 * 开关真正决定工具是否注册进 agent，不是只改展示。
 *
 * 读路径容错归一（复用 core McpConfigParser），写路径失败以 throw 冒出、由
 * UI 边界收口（照 search-config.store 先例）。rename 是换 ID 专用：先改写
 * agent 工具白/黑名单里的 `mcp__<旧ID>__` 引用，再迁 SKSP 密钥与配置——
 * 引用改写失败时反向改回（幂等）并回滚配置，不留一半状态。
 *
 * @module services/mcp-config.store
 */
import {Kkv} from '@novel-master/core/common';
import type {AgentRegistryService} from '@novel-master/core/agent';
import {Result, type AppError} from '@novel-master/core/errors';
import type {KkvService} from '@novel-master/core/kkv';
import {LogFactory} from '@novel-master/core/log';
import {McpConfigParser, McpConfigStoreFactory, McpConnectionManagerFactory, McpOAuthFactory, McpSecretRefs, McpToolRefs, MCP_DEFAULT_TIMEOUT_MS, type McpConnectionManager, type McpOAuth, type McpRequestFn, type McpServerConfig} from '@novel-master/core/mcp';
import type {SecretStore} from '@novel-master/core/sksp';

const log = LogFactory.create('mcp.config');

/** KKV 键名：模块与 servers 键沿用 core McpConfigStore 的公开契约；disabledTools 是 mobile 本地键。 */
const McpStoreKeys = {
    MODULE: McpConfigStoreFactory.KKV_MODULE,
    SERVERS: McpConfigStoreFactory.KEY_SERVERS,
    DISABLED_TOOLS: 'disabledTools',
} as const;

/** 配置镜像（同步读）+ per-server 工具启停 + 连接管理器与 OAuth 的 runtime 切片。 */
export interface McpRuntimeSlice {
    /** 读 KKV 刷新镜像（装配期调用一次；写路径内部已同步刷新，UI 一般无需再调）。 */
    readonly reload: () => Promise<Result<readonly McpServerConfig[], AppError>>;
    /** 同步读全部归一配置（列表页 / 详情页 / OAuth 服务现读的镜像）。 */
    readonly servers: () => readonly McpServerConfig[];
    /** 保存（按 id upsert）+ 落库 + 刷新镜像 + invalidate 该 server 的连接缓存。 */
    readonly save: (config: McpServerConfig) => Promise<void>;
    /** 新建：id 已存在时 throw（不覆盖既有配置），由 UI 边界收口。 */
    readonly create: (config: McpServerConfig) => Promise<void>;
    /** 换 ID 保存：先改写 agent 工具引用（失败反向改回并回滚），再迁 SKSP 密钥与配置；失败以 throw 冒出。 */
    readonly rename: (serverId: string, config: McpServerConfig) => Promise<void>;
    /** 行开关：按 id 改 enabled 落库（列表页乐观更新的写通道）。 */
    readonly setEnabled: (serverId: string, enabled: boolean) => Promise<void>;
    /** 上移 / 下移（delta = -1/+1）：整表重排落库。 */
    readonly reorder: (serverId: string, delta: -1 | 1) => Promise<void>;
    /** 删除 server（core 口径连带清 SKSP bearer/headers/oauth refs）+ 镜像与连接缓存同步失效。 */
    readonly remove: (serverId: string) => Promise<void>;
    /** 读某 server 的禁用工具名清单（镜像同步读）。 */
    readonly disabledTools: (serverId: string) => readonly string[];
    /** 启停某 server 的某工具：镜像 + KKV 同步落库。 */
    readonly setToolDisabled: (serverId: string, toolName: string, disabled: boolean) => Promise<void>;
    /** 连接管理器（快照出口已按工具禁用清单过滤；状态标签与「测试连接」读 serverStatuses）。 */
    readonly connectionManager: McpConnectionManager;
    /** OAuth 双端回调接缝（deep link service 只调 start / handleCallback）。 */
    readonly oauth: McpOAuth;
}

export interface McpRuntimeFactoryDeps {
    readonly kkv: KkvService;
    readonly secretStore: SecretStore;
    /** 换 ID 时改写 agent 工具白/黑名单引用（`mcp__<旧ID>__` → `mcp__<新ID>__`）。 */
    readonly agentRegistry: AgentRegistryService;
    /**
   * 单请求预算（毫秒）→ 请求函数的适配构造（原生 request / 回落 fetch 的方法面
   * 由 runtime 收口）；工厂按各 server 配置的 timeoutMs 选建（同预算 memo 复用），
   * 超时归一（core 钳 >= 1000）保证缓存键有限。
   */
    readonly requestFnFor: (timeoutMs: number) => McpRequestFn;
}

export const McpRuntimeFactory = {
    /**
   * 装配 MCP 切片：闭包内先建镜像状态，再建连接管理器（listServers 注入镜像）
   * 并包一层工具策略过滤，最后建 OAuth 接缝——三个组件共享同一镜像，无循环依赖。
   * 装配期 KKV 读失败按空镜像降级（MCP 是可选功能，不炸 runtime 启动）。
   */
    create: async (deps: McpRuntimeFactoryDeps): Promise<McpRuntimeSlice> => {
        const state = {
            servers: [] as readonly McpServerConfig[],
            disabledTools: {} as Record<string, string[]>,
        };

        // nm-style: keep-local — 镜像读通道：create 内首调 + reload 成员复用（同名计数看不到闭包内引用）。
        const reloadServers = async (): Promise<Result<readonly McpServerConfig[], AppError>> => {
            const raw = await Kkv.getOptional(deps.kkv, McpStoreKeys.MODULE, McpStoreKeys.SERVERS);
            if (!raw.ok) return Result.err(raw.error);
            state.servers = McpConfigParser.parse(raw.value);
            return Result.ok(state.servers);
        };
        const readResult = await reloadServers();
        if (!readResult.ok) {
            log.warn(`MCP 配置读取失败，按空镜像降级: ${readResult.error.message}`);
        }

        const disabledRaw = await Kkv.getOptional(deps.kkv, McpStoreKeys.MODULE, McpStoreKeys.DISABLED_TOOLS);
        if (disabledRaw.ok && disabledRaw.value != null) {
            try {
                const parsed: unknown = JSON.parse(disabledRaw.value);
                if (parsed != null && typeof parsed === 'object') {
                    state.disabledTools = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every(name => typeof name === 'string')));
                }
            } catch {
                // 损坏的工具禁用表按空表处理（迁移容错口径，等价于全部工具启用）
            }
        }

        const requestFnCache = new Map<number, McpRequestFn>();
        const requestFnFor = (timeoutMs: number): McpRequestFn => {
            const cached = requestFnCache.get(timeoutMs);
            if (cached != null) {
                return cached;
            }
            const built = deps.requestFnFor(timeoutMs);
            requestFnCache.set(timeoutMs, built);
            return built;
        };
        // nm-style: keep-local — 闭包内被 baseManager 的 requestFn 引用（同名计数看不到闭包内引用）。
        const timeoutOf = (url: string): number => state.servers.find(candidate => candidate.transport.type !== 'stdio' && candidate.transport.url === url)?.timeoutMs ?? MCP_DEFAULT_TIMEOUT_MS;
        const baseManager = McpConnectionManagerFactory.create({
            listServers: () => state.servers,
            requestFn: req => requestFnFor(timeoutOf(req.url))(req),
            // SKSP get 的失败（infra 异常）由连接管理器按「无 token」兜底（服务器 401 会归 auth）。
            bearerToken: secretRef => deps.secretStore.get(secretRef),
        });

        // nm-style: keep-public — McpConnectionManager port 契约的包装实现（spec §五接口五方法须齐全）：
        // snapshotTools 在出口按镜像禁用清单裁剪工具（run 装配与配置页消费同一份过滤后快照），
        // 其余四成员转手 baseManager——调用点拿到的是 port 对象，无法「直呼 base」绕开包装。
        const connectionManager: McpConnectionManager = {
            // nm-style: keep-local — 策略过滤：快照出口按镜像禁用清单裁剪（run 装配与配置页共用同一份），内联会把策略拆散进消费方；其余四个成员转手 baseManager。
            snapshotTools: async () => {
                const snapshot = await baseManager.snapshotTools();
                return snapshot.filter(entry => !(state.disabledTools[entry.serverId] ?? []).includes(entry.toolName));
            },
            serverStatuses: () => baseManager.serverStatuses(),
            callTool: (serverId: string, toolName: string, args: unknown, signal: AbortSignal) => baseManager.callTool(serverId, toolName, args, signal),
            invalidate: (serverId: string) => baseManager.invalidate(serverId),
            closeAll: () => baseManager.closeAll(),
        };

        // nm-style: keep-local — 镜像写通道：save/setEnabled/reorder 三处共用的「落库 + 刷新 + invalidate」管线。
        const persistServers = async (next: readonly McpServerConfig[], invalidateId: string | null): Promise<void> => {
            await Kkv.setJson(deps.kkv, McpStoreKeys.MODULE, McpStoreKeys.SERVERS, [...next]);
            state.servers = next;
            if (invalidateId != null) {
                baseManager.invalidate(invalidateId);
            }
        };

        // nm-style: keep-local — 换 ID 的存储迁移：SKSP 密钥先写新 ref（旧 ref 暂留），KKV 原位替换，最后清旧 ref。
        const migrateStorage = async (oldId: string, config: McpServerConfig): Promise<void> => {
            const bearer = await deps.secretStore.get(McpSecretRefs.bearer(oldId));
            if (bearer != null) await deps.secretStore.set(McpSecretRefs.bearer(config.id), bearer);
            const headers = await deps.secretStore.get(McpSecretRefs.headers(oldId));
            if (headers != null) await deps.secretStore.set(McpSecretRefs.headers(config.id), headers);
            const oauth = await deps.secretStore.get(McpSecretRefs.oauth(oldId));
            if (oauth != null) await deps.secretStore.set(McpSecretRefs.oauth(config.id), oauth);
            await persistServers(state.servers.map(candidate => (candidate.id === oldId ? config : candidate)), config.id);
            baseManager.invalidate(oldId);
            await Promise.all([deps.secretStore.delete(McpSecretRefs.bearer(oldId)), deps.secretStore.delete(McpSecretRefs.headers(oldId)), deps.secretStore.delete(McpSecretRefs.oauth(oldId))]);
        };

        const oauth = McpOAuthFactory.create({listServers: () => state.servers, secretStore: deps.secretStore});

        return {
            reload: reloadServers,
            servers: () => state.servers,
            save: async (config: McpServerConfig) => {
                const existing = state.servers.findIndex(candidate => candidate.id === config.id);
                await persistServers(existing < 0 ? [...state.servers, config] : state.servers.map(candidate => (candidate.id === config.id ? config : candidate)), config.id);
            },
            create: async (config: McpServerConfig) => {
                if (state.servers.some(candidate => candidate.id === config.id)) {
                    // nm-throw: keep — 写路径口径（见文件头）：撞名失败以 throw 冒出，由 UI 边界收口
                    throw new Error(`MCP ID 已存在: ${config.id}`);
                }
                await persistServers([...state.servers, config], config.id);
            },
            rename: async (serverId: string, config: McpServerConfig) => {
                if (serverId === config.id) {
                    await save(config);
                    return;
                }
                if (state.servers.some(candidate => candidate.id === config.id)) {
                    // nm-throw: keep — 写路径口径（见文件头）：撞名失败以 throw 冒出，由 UI 边界收口
                    throw new Error(`MCP ID 已存在: ${config.id}`);
                }
                const oldConfig = state.servers.find(candidate => candidate.id === serverId);
                try {
                    await McpToolRefs.rewriteAgentTools(deps.agentRegistry, serverId, config.id);
                    await migrateStorage(serverId, config);
                } catch (cause) {
                    // 回滚（尽力、各自幂等）：引用反向改回无命中的 agent 天然跳过；配置迁回旧 id（旧 ref 未清时 SKSP 反向搬迁自愈）。
                    await McpToolRefs.rewriteAgentTools(deps.agentRegistry, config.id, serverId).catch(() => undefined);
                    if (oldConfig != null) await migrateStorage(config.id, oldConfig).catch(() => undefined);
                    // nm-throw: keep — 写路径口径（见文件头）：回滚完成后原错误上抛，由 UI 边界收口
                    throw cause;
                }
            },
            setEnabled: async (serverId: string, enabled: boolean) => {
                const config = state.servers.find(candidate => candidate.id === serverId);
                if (config == null) {
                    return;
                }
                await persistServers(state.servers.map(candidate => (candidate.id === serverId ? {...candidate, enabled} : candidate)), serverId);
            },
            reorder: async (serverId: string, delta: -1 | 1) => {
                const ids = state.servers.map(candidate => candidate.id);
                const from = ids.indexOf(serverId);
                const to = from + delta;
                if (from < 0 || to < 0 || to >= ids.length) {
                    return;
                }
                const next = [...state.servers];
                [next[from], next[to]] = [next[to]!, next[from]!];
                await persistServers(next, serverId);
            },
            remove: async (serverId: string) => {
                const remaining = state.servers.filter(candidate => candidate.id !== serverId);
                await Kkv.setJson(deps.kkv, McpStoreKeys.MODULE, McpStoreKeys.SERVERS, [...remaining]);
                // 工具禁用表同键清理：删除 server 后它的清单不应残留（幂等）。
                if (state.disabledTools[serverId] != null) {
                    const nextTable = {...state.disabledTools};
                    delete nextTable[serverId];
                    await Kkv.setJson(deps.kkv, McpStoreKeys.MODULE, McpStoreKeys.DISABLED_TOOLS, nextTable);
                    state.disabledTools = nextTable;
                }
                state.servers = remaining;
                // SKSP refs 无条件清（幂等）：bearer / 自定义 headers / OAuth 会话一并收走。
                await Promise.all([deps.secretStore.delete(McpSecretRefs.bearer(serverId)), deps.secretStore.delete(McpSecretRefs.headers(serverId)), deps.secretStore.delete(McpSecretRefs.oauth(serverId))]);
                baseManager.invalidate(serverId);
            },
            // nm-style: keep-public — McpRuntimeSlice 接口契约读方法（详情页工具开关初值来源）。
            disabledTools: (serverId: string) => state.disabledTools[serverId] ?? [],
            // nm-style: keep-public — McpRuntimeSlice 接口契约方法（详情页工具开关的唯一写通道），单调用点是接口消费不是内联候选。
            setToolDisabled: async (serverId: string, toolName: string, disabled: boolean) => {
                const current = state.disabledTools[serverId] ?? [];
                const next = disabled ? [...new Set([...current, toolName])] : current.filter(name => name !== toolName);
                const nextTable = {...state.disabledTools, [serverId]: next};
                if (next.length === 0) {
                    delete nextTable[serverId];
                }
                await Kkv.setJson(deps.kkv, McpStoreKeys.MODULE, McpStoreKeys.DISABLED_TOOLS, nextTable);
                state.disabledTools = nextTable;
            },
            connectionManager,
            oauth,
        };
    },
} as const;
