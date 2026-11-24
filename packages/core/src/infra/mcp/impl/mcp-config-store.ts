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
 *
 * namespace 名没按文件名取 `McpConfigStore`（与 port 的接口撞名），按内容主体
 * 取 `McpConfigStoreFactory`，与 spec Step 8 的 `McpConnectionManagerFactory` 对齐。
 *
 * @module infra/mcp/impl/mcp-config-store
 */

import { Kkv } from "@/common/kkv.js";
import { McpConfigParser } from "@/domain/mcp/logic/parse-mcp-server-config.js";
import type { McpServerConfig } from "@/domain/mcp/model/mcp-server-config.js";
import { McpSecretRefs, type McpConfigStore } from "@/domain/mcp/ports/mcp-config-store.port.js";
import type { AppError } from "@/errors/app-error.js";
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
    return Result.ok(McpConfigParser.parse(raw.value).map((outcome) => outcome.config));
};

export const McpConfigStoreFactory = {
    /** KKV 模块名（nm-search / nm-cloud-sync 命名先例）。 */
    KKV_MODULE: "nm-mcp",
    /** KKV 键：归一配置列表（单键存 `McpServerConfig[]`）。 */
    KEY_SERVERS: "servers",

    /** 构造 MCP 配置存储：绑定 kkv + secretStore，读归一复用 McpConfigParser。 */
    create(deps: McpConfigStoreDeps): McpConfigStore {
        const { kkv, secretStore } = deps;
        const { KKV_MODULE, KEY_SERVERS } = McpConfigStoreFactory;
        return {
            list() {
                return readConfigs(kkv);
            },
            async save(config) {
                const current = await readConfigs(kkv);
                if (!current.ok) return Result.err(current.error);
                const next = current.value.some((existing) => existing.id === config.id) ? current.value.map((existing) => (existing.id === config.id ? config : existing)) : [...current.value, config];
                Kkv.setJson(kkv, KKV_MODULE, KEY_SERVERS, next);
                return Result.ok(undefined);
            },
            async remove(serverId) {
                const current = await readConfigs(kkv);
                if (!current.ok) return Result.err(current.error);
                const remaining = current.value.filter((config) => config.id !== serverId);
                if (remaining.length !== current.value.length) Kkv.setJson(kkv, KKV_MODULE, KEY_SERVERS, remaining);
                // SKSP refs 无条件清（幂等）：KKV 损坏回空列表后残留的 ref 也顺手收走。
                await Promise.all([secretStore.delete(McpSecretRefs.bearer(serverId)), secretStore.delete(McpSecretRefs.headers(serverId)), secretStore.delete(McpSecretRefs.oauth(serverId))]);
                return Result.ok(undefined);
            },
            // nm-style: keep-public — McpConfigStore port 契约方法（port:29）；生产消费方是本迭代
            // 后续 Step 的双端 IPC / 配置页接线，T-M2 的 SKSP 落库半边也收在这里。
            async importExternal(raw) {
                const outcomes = McpConfigParser.parse(raw);
                // 识别出的 bearer 明文只进 SKSP；KKV 里是带 ref 的归一配置（T-M2 的落库半边）。
                for (const outcome of outcomes) {
                    if (outcome.bearerPlain != null) await secretStore.set(McpSecretRefs.bearer(outcome.config.id), outcome.bearerPlain);
                }
                const current = await readConfigs(kkv);
                if (!current.ok) return Result.err(current.error);
                // 按 id upsert 合并：现有列表保序，同 id 覆盖原位置，新 id 追加队尾。
                const byId = new Map(current.value.map((config) => [config.id, config]));
                for (const outcome of outcomes) byId.set(outcome.config.id, outcome.config);
                const merged = [...byId.values()];
                Kkv.setJson(kkv, KKV_MODULE, KEY_SERVERS, merged);
                return Result.ok(merged);
            },
        };
    },
} as const;
