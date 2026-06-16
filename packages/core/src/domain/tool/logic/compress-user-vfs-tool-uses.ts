/**
 * 用户 VFS tool_use input 压缩：字符串值替换为 `"…"`，保留键结构与 number/boolean。
 *
 * @module domain/tool/logic/compress-user-vfs-tool-uses
 */

import type { ToolUseBlock } from "@/domain/chat/model/content-block.js";

const PLACEHOLDER = "…";

function compressValue(value: unknown): unknown {
  if (typeof value === "string") {
    return PLACEHOLDER;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = compressValue(child);
    }
    return out;
  }
  return value;
}

/** 压缩用户 VFS U-A-U-A 中 assistant 的 tool_use input。 */
export function compressUserVfsToolUses(
  toolUses: readonly ToolUseBlock[],
): ToolUseBlock[] {
  return toolUses.map((tu) => ({
    ...tu,
    input: compressValue(tu.input) as Record<string, unknown>,
  }));
}
