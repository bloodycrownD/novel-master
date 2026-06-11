import type { AgentToolPolicy } from "@novel-master/core";
import type { ToolsMode } from "./agent-editor-state.js";
import type { AgentDefinition } from "@novel-master/core";

/** Catalog of V2 builtin tools for Agent policy UI (names sync with FILE_TOOL_NAMES + chat_grep). */
export const BUILTIN_TOOL_CATALOG: ReadonlyArray<{
  readonly name: string;
  readonly label: string;
  readonly description: string;
}> = [
  { name: "read", label: "read", description: "读取工作区文件（支持分页）" },
  { name: "write", label: "write", description: "写入或覆盖文件" },
  { name: "edit", label: "edit", description: "查找并替换文件内容" },
  { name: "fs", label: "fs", description: "文件系统命令（ls/rm/mv/cp/mkdir/rmdir）" },
  { name: "glob", label: "glob", description: "按 glob 模式查找路径" },
  { name: "grep", label: "grep", description: "在工作区文件中搜索" },
  { name: "chat_grep", label: "chat_grep", description: "搜索当前会话消息历史" },
] as const;

export function buildToolsPolicyFromSelection(
  mode: ToolsMode,
  selected: readonly string[],
): AgentToolPolicy | undefined {
  if (mode === "default") {
    return undefined;
  }
  const names = [...selected];
  if (mode === "allow") {
    return { allow: names };
  }
  return { deny: names };
}

export function toolsSelectionFromDefinition(def: AgentDefinition): {
  mode: ToolsMode;
  selected: readonly string[];
} {
  if (def.tools?.allow != null) {
    return { mode: "allow", selected: [...def.tools.allow] };
  }
  if (def.tools?.deny != null) {
    return { mode: "deny", selected: [...def.tools.deny] };
  }
  return { mode: "default", selected: [] };
}
