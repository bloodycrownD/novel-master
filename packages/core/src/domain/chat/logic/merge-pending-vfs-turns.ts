/**
 * burst flush：FIFO 合并 pending 队列为单组 actionXml + tool_use + tool_result。
 *
 * @module domain/chat/logic/merge-pending-vfs-turns
 */

import type { ToolResultBlock, ToolUseBlock } from "../model/content-block.js";
import type { UserVfsPendingEntry } from "../model/user-vfs-pending.schema.js";
import { actionXmlToToolUses } from "@/domain/vfs/logic/action-xml-to-tool-uses.js";
import { compressUserVfsToolUses } from "@/domain/tool/logic/compress-user-vfs-tool-uses.js";

export interface MergedPendingVfsTurn {
  readonly actionsXml: string;
  readonly toolUses: readonly ToolUseBlock[];
  readonly toolResults: readonly ToolResultBlock[];
}

/**
 * 按 FIFO 合并 pending 条目；不调用 ToolRunner（磁盘已在各次操作时更新）。
 */
export function mergePendingVfsTurns(
  pending: readonly UserVfsPendingEntry[],
): MergedPendingVfsTurn {
  if (pending.length === 0) {
    return { actionsXml: "", toolUses: [], toolResults: [] };
  }

  const actionsXml = pending.map((entry) => entry.actionXml).join("\n");
  const toolUses: ToolUseBlock[] = [];
  const toolResults: ToolResultBlock[] = [];

  for (const entry of pending) {
    const derived = actionXmlToToolUses(entry.actionXml);
    for (let i = 0; i < entry.tools.length; i++) {
      const tool = entry.tools[i]!;
      const input = derived[i]?.input ?? {};
      const name = derived[i]?.name ?? tool.name;
      toolUses.push({
        type: "tool_use",
        id: tool.id,
        name,
        input,
      });
      toolResults.push({
        type: "tool_result",
        toolUseId: tool.id,
        content: "ok",
        ok: true,
      });
    }
  }

  return {
    actionsXml,
    toolUses: compressUserVfsToolUses(toolUses),
    toolResults,
  };
}
