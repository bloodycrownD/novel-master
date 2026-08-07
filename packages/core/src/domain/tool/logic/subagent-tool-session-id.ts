/**
 * 工具卡片子会话跳转解析：从 tool_result 块的 `meta.subagentSessionId` 读取跳转 id。
 *
 * 对称 {@link vfs-tool-file-path.ts} 的 `resolveVfsToolFilePath`：
 * 后者从 tool_use 输入解析文件路径，本函数从 tool_result meta 解析子会话 id。
 *
 * @module domain/tool/logic/subagent-tool-session-id
 */

import type { ToolResultBlock, ToolUseBlock } from "@/domain/chat/model/content-block.js";

/**
 * 从 tool_result 块解析子代理会话 id（供工具卡片「跳转子会话」门控使用）。
 *
 * 仅 `task` 工具产生的 tool_result 会带 `meta.subagentSessionId`；其余情况返回 undefined，
 * 不抛错。`toolName` 可选地用于额外门控（默认只看 meta 字段是否存在）。
 */
export function resolveSubagentSessionId(
  block: { readonly meta?: { readonly subagentSessionId?: string } } | undefined,
): string | undefined {
  if (block == null) return undefined;
  const sid = block.meta?.subagentSessionId;
  return typeof sid === "string" && sid.length > 0 ? sid : undefined;
}

/**
 * 判定某个 tool_use 是否为 `task` 工具调用（用于在 UI transcript 行映射阶段
 * 给对应 view 标记可跳转子会话）。
 */
export function isTaskToolUse(toolName: string): boolean {
  return toolName === "task";
}

// 这里显式 reexport 上面用到的类型，供 caller 类型推导顺手。
export type { ToolResultBlock, ToolUseBlock };
