/**
 * MCP 接入的 mobile 装配切片（spec mcp-support Step 13/14）。
 *
 * 写路径全部委托 core：配置 CRUD 与每工具启停走 `McpConfigStoreFactory.create`
 * 的 store（KKV nm-mcp + SKSP 的唯一所有者），换 ID 编排走
 * `McpToolRefs.renameWithRewrite`（改写 agent 工具引用 → store.rename →
 * afterRename，任一步失败反向回滚，本文件不再各写一份）。本文件只保留
 * 「同步读镜像」这一层：连接管理器的 `listServers` / `disabledTools` 与 OAuth
 * 工厂的 `listServers` 是同步读接缝，而 KKV 是异步读，所以每次 core 写成功后
 * 一次刷新两份镜像（servers + disabledTools），装配期读失败按空镜像降级并
 * log.warn（MCP 是可选功能，不炸 runtime 启动）。
 *
 * per-server 工具启停的过滤在 core 连接管理器出口按注入的 disabledTools 闭包
 * 执行（先过滤再查撞名）——run 装配期（core AgentTurnRuntimePort.mcp）与配置
 * 页工具卡消费同一份过滤后快照，开关真正决定工具是否注册进 agent。
 *
 * core 写路径的业务失败（create / rename 撞名、KKV 写失败）在本边界转 throw
 * 冒出、由 UI 收口（照 search-config.store 先例）。
 *
 * @module services/mcp-config.store
 */
import type {AgentRegistryService} from '@novel-master/core/agent';
import {Result, type AppError} from '@novel-master/core/errors';
import type {KkvService} from '@novel-master/core/kkv';
import {LogFactory} from '@novel-master/core/log';
import {McpConfigStoreFactory, McpConnectionManagerFactory, McpOAuthFactory, McpToolRefs, MCP_DEFAULT_TIMEOUT_MS, type McpConnectionManager, type McpHttpRequest, type McpHttpResponse, type McpOAuth, type McpRequestFn, type McpServerConfig} from '@novel-master/core/mcp';
import type {SecretStore} from '@novel-master/core/sksp';

const log = LogFactory.create('mcp.config');

/** 配置镜像（同步读）+ per-server 工具启停 + 连接管理器与 OAuth 的 runtime 切片。 */
export interface McpRuntimeSlice {
    /** 经 core store 一次刷新两份镜像（servers + disabledTools）；装配期调用一次，UI 一般无需再调。 */
    readonly reload: () => Promise<Result<readonly McpServerConfig[], AppError>>;
    /** 同步读全部归一配置（列表页 / 详情页 / OAuth 服务现读的镜像）。 */
    readonly servers: () => readonly McpServerConfig[];
    /** 保存（按 id upsert）：core store 落库 + 刷新镜像 + invalidate 该 server 的连接缓存。 */
    readonly save: (config: McpServerConfig) => Promise<void>;
    /** 新建：core store 撞名拒绝（转 throw 由 UI 收口），全程不写任何密钥。 */
    readonly create: (config: McpServerConfig) => Promise<void>;
    /** 换 ID 保存（core renameWithRewrite 编排）：afterRename 在 rename 成功后、回滚链之内执行（写用户新填的 bearer）。 */
    readonly rename: (serverId: string, config: McpServerConfig, afterRename?: () => Promise<void>) => Promise<void>;
    /** 行开关：按 id 改 enabled 落库（列表页乐观更新的写通道）。 */
    readonly setEnabled: (serverId: string, enabled: boolean) => Promise<void>;
    /** 主动连接某台服务器（打开开关 / 保存后调用）：失效快照缓存后重拉，结果进 serverStatuses()。 */
    readonly connect: (serverId: string) => Promise<void>;
    /** 删除 server（core 口径连带清 SKSP bearer/headers/oauth refs 与工具禁用清单）+ 镜像与连接缓存同步失效。 */
    readonly remove: (serverId: string) => Promise<void>;
    /** 读某 server 的禁用工具名清单（镜像同步读）。 */
    readonly disabledTools: (serverId: string) => readonly string[];
    /** 启停某 server 的某工具：core store 落库 + 镜像同步刷新（过滤在连接管理器出口即时生效，无需 invalidate）。 */
    readonly setToolDisabled: (serverId: string, toolName: string, disabled: boolean) => Promise<void>;
    /** 连接管理器（core 实例：快照出口已按工具禁用清单过滤；状态标签与「测试连接」读 serverStatuses）。 */
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
   * 装配 MCP 切片：core store 承接全部写路径，闭包内只养两份镜像与连接管理器
   * （listServers 注入镜像）——三个组件共享同一镜像，无循环依赖。
   */
    create: async (deps: McpRuntimeFactoryDeps): Promise<McpRuntimeSlice> => {
        const store = McpConfigStoreFactory.create({kkv: deps.kkv, secretStore: deps.secretStore});
        const state = {
            servers: [] as readonly McpServerConfig[],
            disabledTools: {} as Record<string, readonly string[]>,
        };

        // nm-style: keep-local — 镜像刷新通道：装配期首调 + reload 成员与全部写路径复用（同名计数看不到闭包内引用）。
        const refreshMirror = async (): Promise<Result<readonly McpServerConfig[], AppError>> => {
            const [listed, disabled] = await Promise.all([store.list(), store.listDisabledTools()]);
            if (!listed.ok) return Result.err(listed.error);
            if (!disabled.ok) return Result.err(disabled.error);
            state.servers = listed.value;
            state.disabledTools = disabled.value;
            return Result.ok(listed.value);
        };
        const readResult = await refreshMirror();
        if (!readResult.ok) {
            log.warn(`MCP 配置读取失败，按空镜像降级: ${readResult.error.message}`);
        }

        // nm-style: keep-local — 连接管理器依赖与切片成员共用的镜像读闭包（读共享 state）。
        const disabledToolsOf = (serverId: string): readonly string[] => state.disabledTools[serverId] ?? [];

        // nm-style: keep-local — 按各 server 的 timeoutMs 选建请求函数并 memo 复用（超时归一后缓存键有限）；闭包内被连接管理器依赖引用。
        const requestFnCache = new Map<number, McpRequestFn>();
        // nm-style: keep-local — 闭包内被 requestFnFor 引用（闭包内引用按名计数看不到）
        const timeoutOf = (url: string): number => state.servers.find(candidate => candidate.transport.type !== 'stdio' && candidate.transport.url === url)?.timeoutMs ?? MCP_DEFAULT_TIMEOUT_MS;
        // nm-style: keep-public — McpConnectionManagerDeps.requestFn 契约的实现（按 server 超时选建并 memo），作为依赖对象成员注入而不是调用
        const requestFnFor = (req: McpHttpRequest): Promise<McpHttpResponse> => {
            const timeoutMs = timeoutOf(req.url);
            const cached = requestFnCache.get(timeoutMs) ?? deps.requestFnFor(timeoutMs);
            requestFnCache.set(timeoutMs, cached);
            return cached(req);
        };
        const connectionManager = McpConnectionManagerFactory.create({
            listServers: () => state.servers,
            requestFn: requestFnFor,
            disabledTools: disabledToolsOf,
            // SKSP get 的失败（infra 异常）由连接管理器按「无 token」兜底（服务器 401 会归 auth）。
            bearerToken: deps.secretStore.get.bind(deps.secretStore),
        });

        // nm-style: keep-local — 写路径共用管线：core 落库成功后一次刷新两份镜像并 invalidate 对应 server（工具过滤走连接管理器出口的活镜像，setToolDisabled 无需 invalidate）。
        const persistThrough = async (write: () => Promise<Result<void, AppError>>, invalidateId: string | null): Promise<void> => {
            const written = await write();
            // nm-throw: keep — 写路径口径（见文件头）：core 的业务失败转 throw，由 UI 边界收口
            if (!written.ok) throw written.error;
            const refreshed = await refreshMirror();
            // nm-throw: keep — 同上
            if (!refreshed.ok) throw refreshed.error;
            if (invalidateId != null) {
                connectionManager.invalidate(invalidateId);
            }
        };

        const oauth = McpOAuthFactory.create({listServers: () => state.servers, secretStore: deps.secretStore});

        return {
            reload: refreshMirror,
            servers: () => state.servers,
            save: async (config: McpServerConfig) => {
                await persistThrough(() => store.save(config), config.id);
            },
            create: async (config: McpServerConfig) => {
                await persistThrough(() => store.create(config), config.id);
            },
            rename: async (serverId: string, config: McpServerConfig, afterRename?: () => Promise<void>) => {
                const renamed = await McpToolRefs.renameWithRewrite({agentRegistry: deps.agentRegistry, configStore: store}, serverId, config, afterRename);
                // nm-throw: keep — 写路径口径（见文件头）：core 的业务失败转 throw，由 UI 边界收口
                if (!renamed.ok) throw renamed.error;
                const refreshed = await refreshMirror();
                // nm-throw: keep — 同上
                if (!refreshed.ok) throw refreshed.error;
                connectionManager.invalidate(serverId);
                connectionManager.invalidate(config.id);
            },
            setEnabled: async (serverId: string, enabled: boolean) => {
                const config = state.servers.find(candidate => candidate.id === serverId);
                if (config == null) {
                    return;
                }
                await persistThrough(() => store.save({...config, enabled}), serverId);
            },
            connect: async (serverId: string) => {
                connectionManager.invalidate(serverId);
                await connectionManager.snapshotTools();
            },
            remove: async (serverId: string) => {
                await persistThrough(() => store.remove(serverId), serverId);
            },
            disabledTools: disabledToolsOf,
            setToolDisabled: async (serverId: string, toolName: string, disabled: boolean) => {
                await persistThrough(() => store.setToolDisabled(serverId, toolName, disabled), null);
            },
            connectionManager,
            oauth,
        };
    },
} as const;
