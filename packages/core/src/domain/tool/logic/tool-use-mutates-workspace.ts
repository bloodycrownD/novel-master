/**
 * 判定 tool_use 是否会改变 session 工作区可见 VFS 状态。
 *
 * @module domain/tool/logic/tool-use-mutates-workspace
 */

import { isMutatingFileToolName } from "../builtin/vfs-tools.js";
import { parseFsCommand } from "./fs-command.js";

/** 单个 tool_use 是否会改变 session 工作区可见 VFS 状态。 */
export function toolUseMutatesWorkspace(
  name: string,
  input: Record<string, unknown>,
): boolean {
  if (!isMutatingFileToolName(name)) {
    return false;
  }
  if (name !== "fs") {
    return true; // write | edit
  }
  const command = typeof input.command === "string" ? input.command : "";
  try {
    return parseFsCommand(command).kind !== "ls";
  } catch {
    // 解析失败时保守视为突变（与 checkpoint 对 fs 的保守策略一致）
    return true;
  }
}

/** 一轮并行 tool_use 中是否存在任一突变。 */
export function anyToolUseMutatesWorkspace(
  toolUses: ReadonlyArray<{ name: string; input: Record<string, unknown> }>,
): boolean {
  return toolUses.some((tu) => toolUseMutatesWorkspace(tu.name, tu.input));
}
