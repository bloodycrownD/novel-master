/**
 * Agent Prompt 布局域形态归一化（strip 旧 worktree 块、保留 workplace string）。
 *
 * @module domain/prompt/logic/normalize-agent-prompt-layout
 */

import type {
  AgentPromptLayout,
  PersistTextPromptBlock,
} from "../model/agent-prompt-layout.js";
import {
  layoutHasCustomAttach,
  layoutHasWorkplace,
} from "../model/agent-prompt-layout.js";

/** wire / 域对象中的旧 worktree 块形状（读入时 strip，不写入域模型）。 */
export type LegacyPersistWorktreeWireBlock = {
  readonly name: string;
  readonly type: "worktree";
  readonly role?: "user" | "assistant";
};

/** 是否为旧 persist worktree 块（读入 strip，不升迁 workplace）。 */
export function isLegacyWorktreeWireBlock(
  block: unknown
): block is LegacyPersistWorktreeWireBlock {
  return (
    block != null &&
    typeof block === "object" &&
    !Array.isArray(block) &&
    (block as { type?: unknown }).type === "worktree"
  );
}

/**
 * 从 wire persist map 丢弃 `type:worktree` 条目（**不**据此设 workplace）。
 */
export function stripLegacyWorktreeBlocksFromPersistMap(
  persist: Record<string, unknown>
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(persist)) {
    if (isLegacyWorktreeWireBlock(item)) {
      continue;
    }
    filtered[name] = item;
  }
  return filtered;
}

/**
 * 域 layout 归一化：persist 仅 text；保留非空 `workplace` string（勿压成 boolean）；丢弃旧 worktree 块。
 *
 * ⚠️ 本函数的返回对象由**显式白名单逐字段重建**，因此白名单必须覆盖
 * {@link AgentPromptLayout} 的全部可选标量字段（`persist` / `dynamic` 两个必填数组除外）。
 * 新增字段时必须同步：① 本白名单；② `test/prompt/normalize-agent-prompt-layout.test.ts`
 * 的「全字段白名单往返」用例夹具；③ 「新增字段必红」的编译期穷举守卫由 wave-e H2 的
 * 类型层 `satisfies Record<Exclude<keyof AgentPromptLayout, "persist" | "dynamic">, null>`
 * 承担（本文件不重复产出，见 wave-e.md H2 Step 1）。
 * ⚠️ 各字段的省略语义**不统一**，勿照抄邻居：
 * `persistEnabled` / `dynamicEnabled` 用 `=== true`（缺省 = 关），
 * 而 `skillsEnabled` 用 `=== false`（缺省 = 开，仅显式 false 表示关闭，
 * 见 `agent-definition.schema.ts`）——写成 `=== true` 会把用户已关闭的技能能力过滤掉。
 */
export function normalizeAgentPromptLayoutDomain(
  layout: AgentPromptLayout
): AgentPromptLayout {
  const persist = layout.persist.filter(
    (block): block is PersistTextPromptBlock =>
      (block as { type?: string }).type === "text"
  );
  return {
    ...(layout.system != null && layout.system.trim() !== ""
      ? { system: layout.system }
      : {}),
    ...(layout.persistEnabled === true ? { persistEnabled: true } : {}),
    ...(layout.dynamicEnabled === true ? { dynamicEnabled: true } : {}),
    ...(layoutHasWorkplace(layout) ? { workplace: layout.workplace } : {}),
    ...(layoutHasCustomAttach(layout)
      ? { customAttach: layout.customAttach }
      : {}),
    // 与 validateAgentPromptLayoutFromMaps 逐字对齐：`skillsEnabled` 是「缺省 = 开」。
    ...(layout.skillsEnabled === false ? { skillsEnabled: false } : {}),
    ...(() => {
      const prefixRaw = layout.skillsPrefix;
      return typeof prefixRaw === "string" && prefixRaw.trim().length > 0
        ? { skillsPrefix: prefixRaw }
        : {};
    })(),
    persist,
    dynamic: [...layout.dynamic],
  };
}
