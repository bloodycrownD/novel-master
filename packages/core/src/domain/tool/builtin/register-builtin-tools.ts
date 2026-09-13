/**
 * Registers V2 builtin workspace file tools + 静态 task / skill / agent /
 * curl / search 工具。
 *
 * @module domain/tool/builtin/register-builtin-tools
 */

import type { ToolRegistry } from "../logic/tool-registry.js";
import type { BuiltinToolContext } from "./builtin-tool-context.js";
import { createVfsTools } from "./vfs-tools.js";
import { subagentTool } from "./subagent-tool.js";
import { skillTool } from "./skill-tool.js";
import { agentTool } from "./agent-tool.js";
import { curlTool } from "./curl-tool.js";
import { searchTool } from "./search/search-tool.js";

/**
 * 注册内置工具：6 个 vfs 工具 + 静态 `task` / `skill` / `agent` / `curl` /
 * `search` 工具（共 11 个）。
 *
 * task / skill / agent 是静态对象，description 是 lambda，装配期由
 * `toolsFromRegistry` 分别读 `ctx.subagent.callableAgents` /
 * `ctx.skills.effective` / `ctx.agents.agents` 求值。task 是否对 LLM
 * 可见由 `resolveAgentToolRegistry` 的 depth 判断控制（孙 agent depth>=2 deny）；
 * agent 与 task 同分支摘除（子/孙 agent 不可管理 agent，D6）；skill 由
 * tools.allow/deny 与技能总开关控制（与 task 同机制，无静态白名单）；
 * curl / search 不在任何摘除分支内，主/子/孙 agent 全深度可用，网络入口
 * 经 `ctx.fetchFn` 可选注入（缺省 globalThis.fetch）；search 另读
 * `ctx.search` 闭包解析引擎（未装配时 run 返回可读错误）。
 */
export function registerBuiltinTools(
  registry: ToolRegistry<BuiltinToolContext>
): void {
  for (const tool of createVfsTools()) {
    registry.register(tool);
  }
  registry.register(subagentTool);
  registry.register(skillTool);
  registry.register(agentTool);
  registry.register(curlTool);
  registry.register(searchTool);
}

/**
 * @deprecated Use {@link registerBuiltinTools}.
 */
export function registerVfsTools(
  registry: ToolRegistry<BuiltinToolContext>
): void {
  registerBuiltinTools(registry);
}
