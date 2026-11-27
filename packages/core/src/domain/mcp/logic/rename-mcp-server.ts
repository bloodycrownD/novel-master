/**
 * MCP 服务器换 ID 编排（双端共用）：`store.rename` 成功后执行调用方的
 * `afterRename`（写用户新填的 bearer 等收尾）。由 rewrite-mcp-tool-references.ts
 * 精简而来——智能体名单里只存 `mcp` 占位词（spec §D），不再存在随服务器 ID
 * 变化的 `mcp__<ID>__<tool>` 工具名，遍历智能体改写工具引用的一步整体删除；
 * 回滚链只剩「配置改名后收尾失败 → 按旧配置改回旧 ID」。
 *
 * @module domain/mcp/logic/rename-mcp-server
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { McpServerConfig } from "../model/mcp-server-config.js";
import type { McpConfigStore, McpRenameOutcome } from "../ports/mcp-config-store.port.js";

export const McpServerRename = {
    /**
     * 换 ID 的编排：`store.rename` → `afterRename`。afterRename 失败就按旧配置
     * 改回旧 ID——不留「配置已改名、密钥写了一半」的状态。回滚尽力而为（自身
     * 失败不吞 afterRename 的错因）。`oldId === config.id` 时只是普通保存。
     */
    // nm-style: keep-public — 双端（desktop handlers/mcp.ts、mobile mcp-config.store.ts）共用的换 ID 编排入口，spec 变更点清单指定本符号进 public。
    withAfterStep: async (deps: { readonly configStore: McpConfigStore }, oldId: string, config: McpServerConfig, afterRename?: () => Promise<void>): Promise<Result<McpRenameOutcome, AppError>> => {
        const { configStore } = deps;
        if (oldId === config.id) {
            const saved = await configStore.save(config);
            return saved.ok ? Result.ok({oauthMigrated: true}) : Result.err(saved.error);
        }
        const listed = await configStore.list();
        if (!listed.ok) return Result.err(listed.error);
        const previous = listed.value.find((server) => server.id === oldId);
        const outcome = await configStore.rename(oldId, config);
        // rename 失败（含新 ID 与别的 server 撞名的拒绝）没有动过配置，直接交回失败。
        if (!outcome.ok) return Result.err(outcome.error);
        try {
            if (afterRename != null) await afterRename();
            return Result.ok(outcome.value);
        } catch (cause: unknown) {
            // 改名已成功而收尾失败：按旧配置改回旧 ID（previous == null 说明旧 ID
            // 本就不在配置里，无从回滚，只交回错因）。
            if (previous != null) await configStore.rename(config.id, previous).catch(() => undefined);
            return Result.err(new AppError("INFRA_UNEXPECTED_ERROR", {detail: cause instanceof Error ? cause.message : String(cause)}));
        }
    },
} as const;
