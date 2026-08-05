/**
 * Registers V2 builtin workspace file tools.
 *
 * @module domain/tool/builtin/register-builtin-tools
 */

import type { ToolRegistry } from "../logic/tool-registry.js";
import type { BuiltinToolContext } from "./builtin-tool-context.js";
import { createVfsTools } from "./vfs-tools.js";
import { createSubagentTool } from "./subagent-tool.js";

/** Registers the 6 V2 builtin file tools into a registry. */
export function registerBuiltinTools(
  registry: ToolRegistry<BuiltinToolContext>,
): void {
  for (const tool of createVfsTools()) {
    registry.register(tool);
  }
  // 废弃：chat_grep 不再注册（实现保留于 chat-grep-tool.ts）
}

/**
 * 装配 `task`（子代理派生）工具。
 *
 * `Tool.description` 是静态 readonly string，动态可选 agent name 列表用工厂方案：
 * `runAgentTurn` 装配期查 registry 拿到 `subagentCallable=true` 的 name 列表，
 * 再调本函数返回一个 description 拼上 name 列表的 Tool 实例，注册到 registry。
 * 不在 `registerBuiltinTools` 全局注册（全局注册拿不到运行时 name 列表）。
 */
export function registerSubagentTool(
  registry: ToolRegistry<BuiltinToolContext>,
  availableNames: readonly string[],
): void {
  registry.register(createSubagentTool(availableNames));
}

/**
 * @deprecated Use {@link registerBuiltinTools}.
 */
export function registerVfsTools(
  registry: ToolRegistry<BuiltinToolContext>,
): void {
  registerBuiltinTools(registry);
}
