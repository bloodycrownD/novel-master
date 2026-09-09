/**
 * agent update 的 patch 合并（部分更新语义）。
 *
 * @module domain/agent/logic/merge-agent-definition-patch
 */

import type { AgentDefinition } from "../model/agent-definition.js";

/**
 * 把 update 提交的 patch 合并进当前定义，返回合并后的完整定义体。
 *
 * 语义（「改什么填什么」）：
 * - **顶层浅合并**：patch 未提供的字段保留现值；提供的字段覆盖。
 * - **`null` 清除**：某字段显式置 `null` 表示删除该字段（回到缺省，如取消
 *   pin 的 model）；与「未提供 = 保留」是两个语义，LLM 可精确表达。
 * - **prompts 子键合并**：`prompts` 为对象时按子键浅合并——只填
 *   `persist` 就只替换 persist，`dynamic` 保留现值；子键置 `null` 清除
 *   该布局；`prompts: null` 清除整个布局（落盘前由
 *   withDefaultPromptLayouts 补回空布局）。
 * - `name` 与普通字段同规则：提供即改名（唯一性由服务层 upsert 校验）。
 *
 * 本函数不校验形状（如 prompts 传字符串会原样落进结果）——语义校验统一
 * 交 `validateAgentDefinition` 与 wire 往返，合并层只负责语义清晰的覆盖。
 */
export function mergeAgentDefinitionPatch(
  current: AgentDefinition,
  patch: Record<string, unknown>,
): AgentDefinition {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    // null = 显式清除字段（回到缺省）
    if (value === null) {
      delete merged[key];
      continue;
    }
    // prompts 对象走子键浅合并；非对象形状（字符串/数组等）原样透传，
    // 让校验层以明确错误拒绝，而不是在这里猜意图。
    if (
      key === "prompts" &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const currentPrompts =
        typeof merged.prompts === "object" && merged.prompts != null
          ? (merged.prompts as Record<string, unknown>)
          : {};
      const nextPrompts: Record<string, unknown> = { ...currentPrompts };
      for (const [subKey, subValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (subValue === null) {
          delete nextPrompts[subKey];
        } else {
          nextPrompts[subKey] = subValue;
        }
      }
      merged.prompts = nextPrompts;
      continue;
    }
    merged[key] = value;
  }
  return merged as unknown as AgentDefinition;
}
