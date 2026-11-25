/**
 * MCP 配置存储实现（spec Step 4 / §七）：KKV 模块 `nm-mcp` 单键 `servers` 存
 * 归一配置列表，密钥走 SKSP——bearer → `mcp/{id}/bearer`、自定义 header 表 →
 * `mcp/{id}/headers`、OAuth 令牌 → `mcp/{id}/oauth`（ref 契约见
 * {@link McpSecretRefs}），KKV 值里永不出现明文。
 *
 * 读路径容错归一（复用 McpConfigParser：损坏 JSON / 形状不认识回空列表、非法
 * 条目跳过、缺 enabled 视为启用）；写路径的可预期失败沿 `Result.err` 返回
 * （照 SearchConfig.createStore 先例，KKV infra 失败原样接力）；`KkvService.set`
 * 与 SecretStore 没有 Result 通道，其失败以 throw 冒出、由调用边界收口。
 * `create` 是新建专用（id 撞名拒绝），`rename` 是换 ID 专用（SKSP 密钥迁新 ref、
 * 先写新后清旧），编辑 upsert 仍走 `save`。
 *
 * namespace 名没按文件名取 `McpConfigStore`（与 port 的接口撞名），按内容主体
 * 取 `McpConfigStoreFactory`，与 spec Step 8 的 `McpConnectionManagerFactory` 对齐。
 *
 * @module infra/mcp/impl/mcp-config-store
 */

import { Kkv } from "@/common/kkv.js";
import { McpConfigParser } from "@/domain/mcp/logic/parse-mcp-server-config.js";
import type { McpServerConfig } from "@/domain/mcp/model/mcp-server-config.js";
import { McpSecretRefs, type McpConfigStore, type McpDisabledTools, type McpRenameOutcome } from "@/domain/mcp/ports/mcp-config-store.port.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";

/** 工厂依赖：调用方注入 kkv 与 secretStore 实例（desktop / mobile runtime 装配）。 */
export interface McpConfigStoreDeps {
    readonly kkv: KkvService;
    readonly secretStore: SecretStore;
}

/** 读全部归一配置：键缺失 → 空列表，损坏值由 parser 容错归一；infra 失败沿 err 接力。 */
const readConfigs = async (kkv: KkvService): Promise<Result<McpServerConfig[], AppError>> => {
    const raw = await Kkv.getOptional(kkv, McpConfigStoreFactory.KKV_MODULE, McpConfigStoreFactory.KEY_SERVERS);
    if (!raw.ok) return Result.err(raw.error);
    return Result.ok([...McpConfigParser.parse(raw.value)]);
};

/** 读每工具启停表：键缺失或损坏 → 空表（等价于全部工具启用）；infra 失败沿 err 接力。 */
const readDisabledTools = async (kkv: KkvService): Promise<Result<Record<string, string[]>, AppError>> => {
    const raw = await Kkv.getOptional(kkv, McpConfigStoreFactory.KKV_MODULE, McpConfigStoreFactory.KEY_DISABLED_TOOLS);
    if (!raw.ok) return Result.err(raw.error);
    return Result.ok(McpConfigParser.parseDisabledTools(raw.value));
};

export const McpConfigStoreFactory = {
    /** KKV 模块名（nm-search / nm-cloud-sync 命名先例）。 */
    KKV_MODULE: "nm-mcp",
    /** KKV 键：归一配置列表（单键存 `McpServerConfig[]`）。 */
    KEY_SERVERS: "servers",
    /** KKV 键：每工具启停表（`{ [serverId]: 被关掉的工具名[] }`）。 */
    KEY_DISABLED_TOOLS: "disabledTools",

    /** 构造 MCP 配置存储：绑定 kkv + secretStore，读归一复用 McpConfigParser。 */
    create(deps: McpConfigStoreDeps): McpConfigStore {
        const { kkv, secretStore } = deps;
        const { KKV_MODULE, KEY_SERVERS, KEY_DISABLED_TOOLS } = McpConfigStoreFactory;
        return {
            list() {
                return readConfigs(kkv);
            },
            async save(config) {
                const current = await readConfigs(kkv);
                if (!current.ok) return Result.err(current.error);
                const next = current.value.some((existing) => existing.id === config.id) ? current.value.map((existing) => (existing.id === config.id ? config : existing)) : [...current.value, config];
                await Kkv.setJson(kkv, KKV_MODULE, KEY_SERVERS, next);
                return Result.ok(undefined);
            },
            async create(config) {
                const current = await readConfigs(kkv);
                if (!current.ok) return Result.err(current.error);
                if (current.value.some((existing) => existing.id === config.id)) return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: `MCP ID 已存在: ${config.id}` }));
                await Kkv.setJson(kkv, KKV_MODULE, KEY_SERVERS, [...current.value, config]);
                return Result.ok(undefined);
            },
            async rename(oldId, config): Promise<Result<McpRenameOutcome, AppError>> {
                const current = await readConfigs(kkv);
                if (!current.ok) return Result.err(current.error);
                if (current.value.some((existing) => existing.id === config.id && existing.id !== oldId)) return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: `MCP ID 已存在: ${config.id}` }));
                // 换 id 时先把 SKSP 密钥写到新 ref（旧 ref 暂留：KKV 写失败时旧配置照常工作，新 ref 只是无害副本），
                // 再原位落库新配置（oldId 条目替换；缺失时按追加防御），最后清旧 ref——不留旧删新未写的中间态。
                let oauthMigrated = true;
                if (oldId !== config.id) {
                    const bearerPlain = await secretStore.get(McpSecretRefs.bearer(oldId));
                    if (bearerPlain != null) await secretStore.set(McpSecretRefs.bearer(config.id), bearerPlain);
                    const headersPlain = await secretStore.get(McpSecretRefs.headers(oldId));
                    if (headersPlain != null) await secretStore.set(McpSecretRefs.headers(config.id), headersPlain);
                    const oauthPlain = await secretStore.get(McpSecretRefs.oauth(oldId));
                    if (oauthPlain != null) {
                        try {
                            await secretStore.set(McpSecretRefs.oauth(config.id), oauthPlain);
                        } catch {
                            // oauth 键搬失败不阻断换 ID：授权态回落未授权，经 oauthMigrated=false 说明。
                            oauthMigrated = false;
                        }
                    }
                }
                const exists = current.value.some((existing) => existing.id === oldId);
                const next = exists ? current.value.map((existing) => (existing.id === oldId ? config : existing)) : [...current.value, config];
                await Kkv.setJson(kkv, KKV_MODULE, KEY_SERVERS, next);
                if (oldId !== config.id) await Promise.all([secretStore.delete(McpSecretRefs.bearer(oldId)), secretStore.delete(McpSecretRefs.headers(oldId)), secretStore.delete(McpSecretRefs.oauth(oldId))]);
                return Result.ok({ oauthMigrated });
            },
            async remove(serverId) {
                const current = await readConfigs(kkv);
                if (!current.ok) return Result.err(current.error);
                const remaining = current.value.filter((config) => config.id !== serverId);
                if (remaining.length !== current.value.length) await Kkv.setJson(kkv, KKV_MODULE, KEY_SERVERS, remaining);
                // SKSP refs 无条件清（幂等）：KKV 损坏回空列表后残留的 ref 也顺手收走。
                await Promise.all([secretStore.delete(McpSecretRefs.bearer(serverId)), secretStore.delete(McpSecretRefs.headers(serverId)), secretStore.delete(McpSecretRefs.oauth(serverId))]);
                // 工具禁用表同清：server 删了，它的清单不该残留（幂等）。
                const disabled = await readDisabledTools(kkv);
                if (disabled.ok && disabled.value[serverId] != null) {
                    const nextTable = {...disabled.value};
                    delete nextTable[serverId];
                    await Kkv.setJson(kkv, KKV_MODULE, KEY_DISABLED_TOOLS, nextTable);
                }
                return Result.ok(undefined);
            },
            async listDisabledTools(): Promise<Result<McpDisabledTools, AppError>> {
                return readDisabledTools(kkv);
            },
            async setToolDisabled(serverId, toolName, disabled) {
                const current = await readDisabledTools(kkv);
                if (!current.ok) return Result.err(current.error);
                const names = current.value[serverId] ?? [];
                const next = disabled ? [...new Set([...names, toolName])] : names.filter((name) => name !== toolName);
                const nextTable = {...current.value};
                if (next.length === 0) delete nextTable[serverId];
                else nextTable[serverId] = next;
                await Kkv.setJson(kkv, KKV_MODULE, KEY_DISABLED_TOOLS, nextTable);
                return Result.ok(undefined);
            },
        };
    },
} as const;
