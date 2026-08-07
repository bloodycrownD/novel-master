/**
 * Registers V2 builtin workspace file tools + 静态 task 工具。
 *
 * @module domain/tool/builtin/register-builtin-tools
 */

import type { ToolRegistry } from "../logic/tool-registry.js";
import type { BuiltinToolContext } from "./builtin-tool-context.js";
import { createVfsTools } from "./vfs-tools.js";
import { subagentTool } from "./subagent-tool.js";

/**
 * 注册内置工具：6 个 vfs 工具 + 静态 `task` 工具。
 *
 * task 是静态对象，description 是 lambda，装配期由 `toolsFromRegistry`
 * 读 `ctx.subagent.callableAgents` 求值。task 是否对 LLM 可见由
 * `resolveAgentToolRegistry` 的 depth 判断控制（孙 agent depth>=2 deny）。
 */
export function registerBuiltinTools(
  registry: ToolRegistry<BuiltinToolContext>,
): void {
  for (const tool of createVfsTools()) {
    registry.register(tool);
  }
  registry.register(subagentTool);
  // 废弃：chat_grep 不再注册（实现保留于 chat-grep-tool.ts）
}

/**
 * @deprecated Use {@link registerBuiltinTools}.
 */
export function registerVfsTools(
  registry: ToolRegistry<BuiltinToolContext>,
): void {
  registerBuiltinTools(registry);
}
