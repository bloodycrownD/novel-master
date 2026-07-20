/**
 * Workplace 物化引擎：从 RuleView 读取正文并拼接持久块。
 *
 * @module domain/workplace/logic/workplace-materialize-engine
 */

import { toPhysicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { joinFileBlocks, renderFileBlock } from "./workplace-display.js";
import type { WorkplaceScope } from "../model/workplace-types.js";
import type { WorkplaceRuleView } from "../model/workplace-rule-view.js";

/**
 * 从规则视图物化持久 workplace 块文本。
 * 按 DFS 文件行顺序遍历；仅对非 hidden 且 full/header 档位读取 VFS 正文。
 */
export async function materializeBlockFromView(
  view: WorkplaceRuleView,
  vfs: VfsEntryRepository,
  scope: WorkplaceScope,
  mtimeByPath: ReadonlyMap<string, number>,
): Promise<string> {
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
      const physical = toPhysicalPath(scope, row.path);
      const entry = await vfs.findByPath(physical);
      content = entry?.content ?? "";
    }
    blocks.push(
      renderFileBlock({
        logicalPath: row.path,
        mtimeMs: mtimeByPath.get(row.path) ?? 0,
        display,
        content,
      }),
    );
  }
  return joinFileBlocks(blocks);
}
