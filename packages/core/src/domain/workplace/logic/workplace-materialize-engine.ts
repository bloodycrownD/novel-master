/**
 * Workplace 物化引擎：从 RuleView 读取正文并拼接持久块。
 *
 * @module domain/workplace/logic/workplace-materialize-engine
 */

import { LogicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { WorkplaceDisplay } from "./workplace-display.js";
import type { WorkplaceScope } from "../model/workplace-types.js";
import type { WorkplaceRuleView } from "../model/workplace-rule-view.js";

export const WorkplaceMaterializeEngine = {
    /**
   * 从规则视图物化持久 workplace 块文本。
   * 按 DFS 文件行顺序遍历；仅对非 hidden 且 full/header 档位读取 VFS 正文。
   */
    async materializeBlockFromView(view: WorkplaceRuleView, vfs: VfsEntryRepository, scope: WorkplaceScope, mtimeByPath: ReadonlyMap<string, number>): Promise<Result<string, AppError>> {
        const scopeKeyStr = LogicalPath.scopeKey(scope);
        const blocks: string[] = [];
        for (const row of view.rows) {
            if (row.kind !== "file") {
                continue;
            }
            const display = view.displayByPath.get(row.path) ?? row.displayState;
            if (display === "hidden") {
                continue;
            }
            let content = "";
            if (display === "full" || display === "header") {
                // entry_id 化后 path 列直接存纯逻辑路径，无需物理前缀拼接
                const entry = await vfs.findByPath(scopeKeyStr, row.path);
                if (!entry.ok) return Result.err(entry.error);
                content = entry.value?.content ?? "";
            }
            const block = WorkplaceDisplay.renderFileBlock({
                logicalPath: row.path,
                mtimeMs: mtimeByPath.get(row.path) ?? 0,
                display,
                content,
            });
            blocks.push(block);
        }
        return Result.ok(WorkplaceDisplay.joinFileBlocks(blocks));
    },
} as const;
