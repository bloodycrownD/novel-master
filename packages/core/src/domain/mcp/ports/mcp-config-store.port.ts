/**
 * MCP 配置存储 port：KKV 模块 `nm-mcp` 存归一配置列表 + SKSP 存密钥（spec §七）。
 * 实现在 infra/mcp/impl/mcp-config-store（Step 4）；读路径容错归一、写路径是
 * 错误边界——失败沿 `Result.err` 返回，throw 收在调用边界。
 *
 * @module domain/mcp/ports/mcp-config-store.port
 */

import type { Result } from "@/errors/either.js";
import type { AppError } from "@/errors/app-error.js";
import type { McpServerConfig } from "../model/mcp-server-config.js";

/** SKSP ref 命名契约（spec §七）：bearer 密钥 / 自定义 header 表 / OAuth 令牌。 */
export const McpSecretRefs = {
    bearer: (serverId: string): string => `mcp/${serverId}/bearer`,
    headers: (serverId: string): string => `mcp/${serverId}/headers`,
    oauth: (serverId: string): string => `mcp/${serverId}/oauth`,
} as const;

/** MCP 配置存储（配置 CRUD 的唯一接缝；密钥明文经 SKSP，KKV 只存 ref）。 */
export interface McpConfigStore {
    /** 读取全部归一配置（含 disabled；读路径容错，损坏值回空列表缺省）。 */
    list(): Promise<Result<readonly McpServerConfig[], AppError>>;
    /** 保存（按 id upsert）；写路径失败沿 Result.err 返回。 */
    save(config: McpServerConfig): Promise<Result<void, AppError>>;
    /** 删除 server，并连带清掉它的 SKSP refs（bearer / headers / oauth）。 */
    remove(serverId: string): Promise<Result<void, AppError>>;
    /** 导入外部格式（如 Claude Desktop 的 `{mcpServers:{...}}`）：解析归一 + 识别出的 bearer 明文落 SKSP + 整表持久化。 */
    importExternal(raw: unknown): Promise<Result<readonly McpServerConfig[], AppError>>;
}
