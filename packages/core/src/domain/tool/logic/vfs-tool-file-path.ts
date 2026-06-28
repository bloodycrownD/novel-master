/**
 * 工具卡片 VFS 文件路径解析：将 tool_use 输入规范化为可打开的逻辑路径。
 *
 * @module domain/tool/logic/vfs-tool-file-path
 */

import { resolveLogicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";

/** 可在工作区预览中打开文件的工具名（不含 vfs. 前缀）。 */
const FILE_OPEN_TOOL_NAMES = new Set(["read", "write", "edit"]);

/**
 * 解析工具调用输入中的 VFS 文件路径，供工具卡片「打开文件」门控使用。
 *
 * 仅对 read/write/edit（及 vfs.* 前缀别名）处理；非法或空路径返回 undefined，不抛错。
 *
 * @param toolName - 工具名，如 `write` 或 `vfs.read`
 * @param input - tool_use 输入对象，需含字符串字段 `path`
 * @returns 规范化逻辑路径（以 `/` 开头），或 undefined
 */
export function resolveVfsToolFilePath(
  toolName: string,
  input: Record<string, unknown> | null | undefined,
): string | undefined {
  const name = toolName.startsWith("vfs.") ? toolName.slice(4) : toolName;
  if (!FILE_OPEN_TOOL_NAMES.has(name)) return undefined;
  const raw = input?.path;
  if (typeof raw !== "string") return undefined;
  try {
    return resolveLogicalPath(raw);
  } catch {
    return undefined;
  }
}
