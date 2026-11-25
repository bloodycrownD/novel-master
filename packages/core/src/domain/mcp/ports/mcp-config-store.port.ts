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

/** {@link McpConfigStore.rename} 的结果：oauthMigrated=false 表示旧 OAuth 会话键搬迁失败（授权态回落未授权，需重新授权）。 */
export interface McpRenameOutcome {
    readonly oauthMigrated: boolean;
}

/** MCP 配置存储（配置 CRUD 的唯一接缝；密钥明文经 SKSP，KKV 只存 ref）。 */
export interface McpConfigStore {
    /** 读取全部归一配置（含 disabled；读路径容错，损坏值回空列表缺省）。 */
    list(): Promise<Result<readonly McpServerConfig[], AppError>>;
    /** 保存（按 id upsert：同 id 覆盖原位置、新 id 追加）；写路径失败沿 Result.err 返回。 */
    save(config: McpServerConfig): Promise<Result<void, AppError>>;
    /** 新建：id 已存在时拒绝（Result.err），不覆盖既有配置；编辑与换 ID 分别走 save / rename。 */
    create(config: McpServerConfig): Promise<Result<void, AppError>>;
    /** 换 ID 保存：新 id 与其它 server 撞名时拒绝；成功 = 新配置原位落库 + SKSP 密钥（bearer / headers / oauth）迁到新 ref + 清旧条目与旧 ref（先写新后清旧，不留旧删新未写的中间态）。 */
    rename(oldId: string, config: McpServerConfig): Promise<Result<McpRenameOutcome, AppError>>;
    /** 删除 server，并连带清掉它的 SKSP refs（bearer / headers / oauth）与工具禁用清单。 */
    remove(serverId: string): Promise<Result<void, AppError>>;
    /** 读每工具启停表：`{ [serverId]: 被关掉的工具名[] }`（读路径容错，损坏值回空表）。 */
    listDisabledTools(): Promise<Result<McpDisabledTools, AppError>>;
    /** 关闭 / 恢复某 server 的某个工具（清空时移除该 server 的条目）。 */
    setToolDisabled(serverId: string, toolName: string, disabled: boolean): Promise<Result<void, AppError>>;
}

/** 每工具启停表：键是 serverId，值是被用户关掉的工具名。 */
export type McpDisabledTools = Readonly<Record<string, readonly string[]>>;
