/**
 * 判定 tool_use 是否会改变 session 工作区可见 VFS 状态。
 *
 * @module domain/tool/logic/tool-use-mutates-workspace
 */

import { FileTools } from "../builtin/vfs-tools.js";
import { FsCommand } from "./fs-command.js";

export const ToolUseMutation = {
  /** 单个 tool_use 是否会改变 session 工作区可见 VFS 状态。 */
  mutates(name: string, input: Record<string, unknown>): boolean {
    if (!FileTools.isMutatingName(name)) {
      return false;
    }
    if (name !== "fs") {
      return true; // write | edit
    }
    const action = typeof input.action === "string" ? input.action : "";
    // checkpoint 对无 action 保守视为突变；runner 路径串行化则视为非突变（见 fs-command）
    if (action === "") {
      return true;
    }
    return FsCommand.classify(input).mutating;
  },

  /** 一轮并行 tool_use 中是否存在任一突变。 */
  any(toolUses: ReadonlyArray<{ name: string; input: Record<string, unknown> }>): boolean {
    return toolUses.some((tu) => ToolUseMutation.mutates(tu.name, tu.input));
  },
} as const;
