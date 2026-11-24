/**
 * MCP OAuth 2.1 provider（spec Step 12 / §八）：官方 `OAuthClientProvider` 契约
 * （`@modelcontextprotocol/client@2.4.0` 的类型声明为准）的 core 实现，外加
 * {@link McpOAuth} port（`domain/mcp/ports/mcp-connection.port`）的双端回调接缝。
 *
 * 全部 OAuth 会话状态落 SKSP 单键 `mcp/{serverId}/oauth`（ref 契约
 * {@link McpSecretRefs.oauth}）的 JSON 对象：tokens / clientInformation /
 * codeVerifier / state / redirectUrl / discoveryState 各占一个独立键。PKCE
 * verifier 与 state 必须持久化、不能只放内存——移动端授权期间进程可能被系统
 * 回收，回来后新建 provider 实例先读回 verifier 才能换 token（spec §八）。
 *
 * provider 契约方法沿 SDK 协议以 throw 报错（官方接口没有 Result 通道，与 zod
 * preprocess 同为边界例外）；{@link McpOAuthFactory.create} 产出的两个入口是
 * Result 边界，可预期失败收成 `INFRA_VALIDATION_FAILED`（detail 永远带原文），
 * SDK 抛出的非 OAuthError 异常收成 `INFRA_UNEXPECTED_ERROR`——MCP 域尚无专属
 * 错误码（error-codes.ts 本节点不改），后续接线波次如需专属码在此集中替换。
 *
 * @module infra/mcp/impl/mcp-oauth-provider
 */

import { auth, type FetchLike, type OAuthClientMetadata, type OAuthClientProvider, type OAuthDiscoveryState, type StoredOAuthClientInformation, type StoredOAuthTokens } from "@modelcontextprotocol/client";
import { Guards } from "@/common/guards.js";
import { Json } from "@/common/json.js";
import { Random } from "@/common/random.js";
import type { McpAuthType, McpServerConfig } from "@/domain/mcp/model/mcp-server-config.js";
import { McpSecretRefs } from "@/domain/mcp/ports/mcp-config-store.port.js";
import type { McpOAuth } from "@/domain/mcp/ports/mcp-connection.port.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";

/** `mcp/{serverId}/oauth` 单键的持久化形状；undefined 字段经 JSON.stringify 消失即删除语义。 */
interface McpOAuthPersisted {
    readonly client?: StoredOAuthClientInformation;
    readonly tokens?: StoredOAuthTokens;
    readonly codeVerifier?: string;
    readonly state?: string;
    readonly redirectUrl?: string;
    readonly discovery?: OAuthDiscoveryState;
}

/** `invalidateCredentials` 的 scope（官方契约枚举）。 */
type McpInvalidateScope = "all" | "client" | "tokens" | "verifier" | "discovery";

/** scope → 要清空的字段（"all" 直接删整键，不在此表）。 */
const CLEAR_FIELDS: Readonly<Record<Exclude<McpInvalidateScope, "all">, Partial<McpOAuthPersisted>>> = {
    client: { client: undefined },
    tokens: { tokens: undefined },
    verifier: { codeVerifier: undefined, state: undefined },
    discovery: { discovery: undefined },
};

/** app 回调的原始载荷（桌面 loopback handler 与移动 deep link service 原样透传的查询参数）。 */
interface McpOAuthCallback {
    readonly code?: string;
    readonly state?: string;
    readonly error?: string;
}

/**
 * 单个 MCP server 的 OAuth 客户端（官方 {@link OAuthClientProvider} 契约实现）。
 * 无内存缓存：每个契约方法现读现写 SKSP，跨实例（进程重启）语义天然正确；
 * 同一流程内 SDK 顺序调用这些方法，读改写之间没有并发写者，不需要加锁。
 */
export class McpOAuthProvider implements OAuthClientProvider {
    private redirect: string | undefined;
    /** 最近一次授权跳转 URL（redirectToAuthorization 记录，start 返回给调用方开浏览器）。 */
    authorizeUrl: string | null = null;

    private constructor(private readonly ref: string, private readonly secretStore: SecretStore) {}

    /**
     * 恢复（或新建）provider：从 SKSP 读回持久化状态；传入 `redirectUrl` 时绑定
     * 该值并持久化（start 的授权腿），不传则沿用已存的值（handleCallback 的回调
     * 腿——SDK 在 code 换 token 时要求 provider.redirectUrl 与发起时一致）。
     */
    static async restore(serverId: string, secretStore: SecretStore, redirectUrl?: string): Promise<McpOAuthProvider> {
        const provider = new McpOAuthProvider(McpSecretRefs.oauth(serverId), secretStore);
        const persisted = await provider.load();
        provider.redirect = redirectUrl ?? persisted.redirectUrl;
        if (redirectUrl != null && redirectUrl !== persisted.redirectUrl) await provider.patch({ redirectUrl });
        return provider;
    }

    // nm-style: keep-public — OAuthClientProvider 契约 getter；官方 SDK 按接口名调用，按名计数看不见运行时消费。
    get redirectUrl(): string | URL | undefined {
        return this.redirect;
    }

    // nm-style: keep-public — OAuthClientProvider 契约 getter（DCR 提交元数据），官方 SDK 运行时按接口名调用。
    /**
     * DCR 客户端元数据：桌面 loopback / 移动 deep link 都是 public client（无
     * client_secret），`token_endpoint_auth_method: "none"`；redirect_uris 必须与
     * 发起授权时的 redirect_uri 逐字一致，否则授权服务器会拒。
     */
    get clientMetadata(): OAuthClientMetadata {
        return { client_name: "nm", redirect_uris: this.redirect == null ? [] : [this.redirect], response_types: ["code"], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none" };
    }

    /** 生成并持久化 OAuth state（一次性消费：handleCallback 校验通过后随 verifier 一起清掉）。 */
    async state(): Promise<string> {
        const value = Random.uuid();
        await this.patch({ state: value });
        return value;
    }

    // nm-style: keep-public — OAuthClientProvider 契约方法（DCR 结果读回 + 回调腿换 token），官方 SDK 运行时按接口名调用。
    async clientInformation(): Promise<StoredOAuthClientInformation | undefined> {
        return (await this.load()).client;
    }

    // nm-style: keep-public — OAuthClientProvider 契约方法（DCR 结果落库），官方 SDK 运行时按接口名调用。
    async saveClientInformation(clientInformation: StoredOAuthClientInformation): Promise<void> {
        await this.patch({ client: clientInformation });
    }

    // nm-style: keep-public — OAuthClientProvider 契约方法（transport 每请求读 bearer token），官方 SDK 运行时按接口名调用。
    async tokens(): Promise<StoredOAuthTokens | undefined> {
        return (await this.load()).tokens;
    }

    // nm-style: keep-public — OAuthClientProvider 契约方法（交换 / 刷新成功后落库），官方 SDK 运行时按接口名调用。
    async saveTokens(tokens: StoredOAuthTokens): Promise<void> {
        await this.patch({ tokens });
    }

    // nm-style: keep-public — OAuthClientProvider 契约方法（授权腿跳浏览器），官方 SDK 运行时按接口名调用。
    async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
        this.authorizeUrl = String(authorizationUrl);
    }

    // nm-style: keep-public — OAuthClientProvider 契约方法（PKCE verifier 持久化），官方 SDK 运行时按接口名调用。
    async saveCodeVerifier(codeVerifier: string): Promise<void> {
        await this.patch({ codeVerifier });
    }

    /** 读回发起授权时保存的 PKCE verifier；缺失说明授权发起记录丢了（换 token 无法继续）。 */
    async codeVerifier(): Promise<string> {
        const verifier = (await this.load()).codeVerifier;
        // nm-throw: keep — OAuthClientProvider 契约边界：codeVerifier(): Promise<string> 无 Result 通道，缺失只能以异常上行、由官方 auth() 收口。
        if (verifier == null) throw new Error(`缺少 PKCE codeVerifier：${this.ref}（授权发起记录丢失，请重新发起授权）`);
        return verifier;
    }

    // nm-style: keep-public — OAuthClientProvider 契约方法（官方 auth() 在 invalid_client / invalid_grant 时按接口名调用重试）。
    /**
     * SDK 按需失效凭据（invalid_client / invalid_grant 自动重试时调用）：`"all"`
     * 直接删整键，其余 scope 只清对应字段；`"verifier"` 连 state 一起清——两者
     * 同属一次授权尝试的一次性状态。
     */
    async invalidateCredentials(scope: McpInvalidateScope): Promise<void> {
        if (scope === "all") {
            await this.secretStore.delete(this.ref);
            return;
        }
        await this.patch(CLEAR_FIELDS[scope]);
    }

    // nm-style: keep-public — SDK 要求 saveDiscoveryState 与 discoveryState 成对实现（实现前者的前提下，
    // 回调腿读不到 discovery state 会直接抛 AuthorizationServerMismatchError），两者是同一 IO 管线的两端。
    async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
        await this.patch({ discovery: state });
    }

    // nm-style: keep-public — OAuthClientProvider 契约方法（与 saveDiscoveryState 成对的读端），官方 SDK 运行时按接口名调用。
    async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
        return (await this.load()).discovery;
    }

    // nm-style: keep-public — provider 会话状态的领域操作（读自身持久化 state 做 CSRF 校验）；McpOAuthFactory 闭包没有 persisted 形状的访问通道，不能 own 这段逻辑。
    /**
     * 回调腿前置校验：授权服务器明确报 error 原样拒收、state 与发起时不一致拒收
     * （state 防 CSRF，SDK 不校验、是 host 的责任）、code 缺失拒收；通过后返回待
     * 交换的 code。
     */
    async verifyCallback(callback: McpOAuthCallback): Promise<Result<string, AppError>> {
        if (callback.error != null) return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: `授权服务器返回错误: ${callback.error}` }));
        const pending = (await this.load()).state;
        if (pending == null) return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: `没有进行中的 OAuth 授权: ${this.ref}` }));
        if (callback.state !== pending) return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: "OAuth state 与发起时不一致，可能为 CSRF 或过期回调" }));
        if (callback.code == null) return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: "回调缺少授权 code" }));
        return Result.ok(callback.code);
    }

    /**
     * 读 `mcp/{serverId}/oauth` 并容错归一：键缺失回空对象，损坏 JSON / 字段形状
     * 不认识按未知丢弃（与配置迁移同口径）。tokens / client / discovery 顶层形状
     * 由 isRecord 保证，内部字段交 SDK 消费侧处理——坏值会在刷新 / 交换时失败并
     * 回退到重新授权，不会静默错误授权。
     */
    private async load(): Promise<McpOAuthPersisted> {
        const raw = await this.secretStore.get(this.ref);
        if (raw == null) return {};
        const parsed = Json.parseText(raw);
        if (!parsed.ok || !Guards.isRecord(parsed.value)) return {};
        const objectOf = <T>(value: unknown): T | undefined => (Guards.isRecord(value) ? (value as T) : undefined);
        const textOf = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
        return { client: objectOf(parsed.value.client), tokens: objectOf(parsed.value.tokens), discovery: objectOf(parsed.value.discovery), codeVerifier: textOf(parsed.value.codeVerifier), state: textOf(parsed.value.state), redirectUrl: textOf(parsed.value.redirectUrl) };
    }

    // nm-style: keep-local — 全部 setter 的共享 SKSP IO 管线：读改写单键 JSON 的原子性收在这一处。
    private async patch(fields: Partial<McpOAuthPersisted>): Promise<void> {
        await this.secretStore.set(this.ref, JSON.stringify({...await this.load(), ...fields}));
    }
}

/** {@link McpOAuthFactory.create} 的装配依赖（最窄读接缝，照 McpConnectionManagerDeps 先例）。 */
export interface McpOAuthDeps {
    /** 归一配置列表（每次调用现读，与连接管理器同口径；按 serverId 查 http 端点）。 */
    readonly listServers: () => readonly McpServerConfig[];
    /** SKSP 读写（OAuth 全部会话状态的单键存储）。 */
    readonly secretStore: SecretStore;
    /** 授权服务器请求（discovery / DCR / token 端点）的 fetch 注入；缺省用全局 fetch。 */
    readonly fetchFn?: FetchLike;
}

/**
 * nm-style: keep-public — spec §八指定的装配形态（McpOAuthFactory.create(deps)）；
 * 生产消费在双端 runtime / IPC 接线波次，本波次仅测试可达。
 */
export const McpOAuthFactory = {
    /** 构造 {@link McpOAuth} 双端回调接缝：start 发起授权腿、handleCallback 接住回调完成交换。 */
    create(deps: McpOAuthDeps): McpOAuth {
        // 联合收窄不穿 Result：守卫在闭包内判完，返回窄投影（url / name / authType）。
        const httpServer = async (serverId: string): Promise<Result<{ readonly url: string; readonly name: string; readonly authType: McpAuthType }, AppError>> => {
            const config = deps.listServers().find((candidate) => candidate.id === serverId);
            if (config == null) return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: `MCP 服务器未配置: ${serverId}` }));
            if (config.transport.type !== "http") return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: `MCP 服务器 ${config.name} 不是 Streamable HTTP 传输，无法走 OAuth 授权` }));
            return Result.ok({ url: config.transport.url, name: config.name, authType: config.auth.type });
        };
        return {
            /**
             * 发起授权：返回的 authorizeUrl 由调用方开浏览器（桌面 shell.openExternal
             * + 本地 loopback server，移动 Linking.openURL）。`forceReauthorization`
             * 是 start 语义的一部分——UI 调 start 就是显式要重新授权，不让 SDK 拿
             * refresh_token 静默刷新而跳过浏览器跳转。
             */
            async start(serverId: string, redirectUrl: string): Promise<Result<{ readonly authorizeUrl: string }, AppError>> {
                const server = await httpServer(serverId);
                if (!server.ok) return Result.err(server.error);
                if (server.value.authType !== "oauth") return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: `MCP 服务器 ${server.value.name} 未配置 OAuth 鉴权` }));
                const provider = await McpOAuthProvider.restore(serverId, deps.secretStore, redirectUrl);
                try {
                    const outcome = await auth(provider, { serverUrl: server.value.url, forceReauthorization: true, ...(deps.fetchFn == null ? {} : { fetchFn: deps.fetchFn }) });
                    if (outcome !== "REDIRECT" || provider.authorizeUrl == null) return Result.err(new AppError("INFRA_UNEXPECTED_ERROR", { detail: `OAuth start 未产生授权跳转: ${outcome}` }));
                    return Result.ok({ authorizeUrl: provider.authorizeUrl });
                } catch (error) {
                    return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: `OAuth 授权发起失败: ${error instanceof Error ? error.message : String(error)}` }));
                }
            },
            // nm-style: keep-public — spec §八指定的双端回调入口（桌面 IPC handler / 移动 deep link service 只调它），
            // 生产消费在本迭代后续接线波次（Step 13），本波次仅测试可达。
            /**
             * 接住回调完成 code 换 token：state 校验（CSRF）→ 官方 auth() 交换 →
             * 一次性状态（verifier + state）无论成败都清掉。SKSP infra 失败以
             * throw 冒出、由更上层的 IPC / service 边界收口（与配置 store 同口径）。
             */
            async handleCallback(serverId: string, callback: McpOAuthCallback): Promise<Result<void, AppError>> {
                const server = await httpServer(serverId);
                if (!server.ok) return Result.err(server.error);
                const provider = await McpOAuthProvider.restore(serverId, deps.secretStore);
                const code = await provider.verifyCallback(callback);
                if (!code.ok) return Result.err(code.error);
                try {
                    await auth(provider, { serverUrl: server.value.url, authorizationCode: code.value, ...(deps.fetchFn == null ? {} : { fetchFn: deps.fetchFn }) });
                    return Result.ok(undefined);
                } catch (error) {
                    return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: `OAuth code 换 token 失败: ${error instanceof Error ? error.message : String(error)}` }));
                } finally {
                    try {
                        await provider.invalidateCredentials("verifier");
                    } catch {
                        // 清理失败不覆盖主结果：残留的 verifier / state 会被下次授权覆盖
                    }
                }
            },
        };
    },
} as const;
