/**
 * Registers V2 builtin workspace file tools + 静态 task 工具。
 *
 * @module domain/tool/builtin/register-builtin-tools
 */

import type { ToolRegistry } from "../logic/tool-registry.js";
import type { BuiltinToolContext } from "./builtin-tool-context.js";
import { createVfsTools } from "./vfs-tools.js";
import { subagentTool } from "./subagent-tool.js";
import { skillTool } from "./skill-tool.js";

/**
 * 注册内置工具：6 个 vfs 工具 + 静态 `task` 工具 + 静态 `skill` 工具。
 *
 * task / skill 是静态对象，description 是 lambda，装配期由
 * `toolsFromRegistry` 分别读 `ctx.subagent.callableAgents` /
 * `ctx.skills.effective` 求值。task 是否对 LLM 可见由
 * `resolveAgentToolRegistry` 的 depth 判断控制（孙 agent depth>=2 deny）；
 * skill 由 tools.allow/deny 控制（与 task 同机制，无静态白名单）。
 */
export function registerBuiltinTools(
  registry: ToolRegistry<BuiltinToolContext>,
): void {
  for (const tool of createVfsTools()) {
    registry.register(tool);
  }
  registry.register(subagentTool);
  registry.register(skillTool);
}

/**
 * @deprecated Use {@link registerBuiltinTools}.
 */
export function registerVfsTools(
  registry: ToolRegistry<BuiltinToolContext>,
): void {
  registerBuiltinTools(registry);
}
