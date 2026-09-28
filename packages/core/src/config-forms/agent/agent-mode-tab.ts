/**
 * Agent 设置页 tab 过滤口径（主 / 子）的单点收口。
 *
 * @module config-forms/agent/agent-mode-tab
 */

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";

/** Agent 设置页 tab：主智能体列表 / 子代理列表。 */
export type AgentSettingsTab = "primary" | "subagent";

/**
 * 判断定义的 mode 是否应显示在指定 tab。
 *
 * 口径与运行侧过滤保持一致（字面等价）：
 * - 未填写（undefined）按 `all` 归一，双侧 tab 都显示；
 * - 子侧运行口径见 `subagent-tool.ts`（`mode !== "primary"` 才可作为子代理调用），
 *   故子 tab = 归一值 !== "primary"；
 * - 主 tab = 归一值 !== "subagent"（`all` 同时在主 / 子两侧显示）。
 *
 * 双端 UI 的 picker 过滤统一消费本函数，不各自内联判断。
 */
export function agentModeMatchesTab(
  mode: AgentDefinition["mode"] | undefined,
  tab: AgentSettingsTab
): boolean {
  const normalized = mode ?? "all";
  return tab === "primary"
    ? normalized !== "subagent"
    : normalized !== "primary";
}
