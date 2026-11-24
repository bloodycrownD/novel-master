/**
 * MCP 服务器配置模型：外部 / 存储配置归一后的内部形态（双端共享契约，spec §七）。
 *
 * `transport` 是联合而非可选字段——stdio / sse 只归一保留（首版不实现传输，
 * 连接管理器按 {@link McpServerConfigOps.isTransportSupported} 判不可用），
 * 归一时 stdio 的 command / args / env / cwd 细节一律丢弃（spec Step 11）。
 * bearer 鉴权只携带 SKSP ref，明文永不进 KKV。
 *
 * @module domain/mcp/model/mcp-server-config
 */

/** 传输类型（归一后仅三值；streamableHttp / streamable-http / streamable_http 均归一为 http）。 */
export type McpTransportType = "stdio" | "http" | "sse";

/** 鉴权类型。 */
export type McpAuthType = "none" | "bearer" | "oauth";

/** 鉴权配置：bearer 只带 SKSP ref（`mcp/{serverId}/bearer`），明文只活在 SKSP。 */
export type McpAuthConfig =
    | { readonly type: "none" }
    | { readonly type: "bearer"; readonly secretRef: string }
    | { readonly type: "oauth" };

/** 传输配置：stdio 不携带任何子进程细节；http / sse 携带端点 URL。 */
export type McpTransportConfig =
    | { readonly type: "stdio" }
    | { readonly type: "http"; readonly url: string }
    | { readonly type: "sse"; readonly url: string };

/** 单个 MCP 服务器的归一配置（KKV 模块 `nm-mcp` 的存储形态）。 */
export interface McpServerConfig {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly transport: McpTransportConfig;
    /** 单个 HTTP 请求的超时上限（毫秒，握手 / tools/list / tools/call 各自适用）。 */
    readonly timeoutMs: number;
    readonly auth: McpAuthConfig;
}

/** `timeoutMs` 缺省值（部分 MCP 工具本身要跑几十秒，太短会误杀；spec §五）。 */
export const MCP_DEFAULT_TIMEOUT_MS = 120_000;

/** `timeoutMs` 归一下限：0 / 负数钳到此值（原生层对 <= 0 会落回 600 秒默认预算，spec §七）。 */
export const MCP_MIN_TIMEOUT_MS = 1_000;

/** 传输可用性判定（spec Step 11）：首版只有 http 可连；stdio / sse 由连接管理器报 `unsupported`。 */
export const McpServerConfigOps = {
    isTransportSupported: (config: McpServerConfig): boolean => config.transport.type === "http",
} as const;
