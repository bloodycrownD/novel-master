/**
 * Agent Prompt 布局域形态归一化（strip 旧 worktree 块、保留 workplace string）。
 *
 * @module domain/prompt/logic/normalize-agent-prompt-layout
 */

import type {
  AgentPromptLayout,
  PersistTextPromptBlock,
} from "../model/agent-prompt-layout.js";
import { layoutHasWorkplace } from "../model/agent-prompt-layout.js";

/** wire / 域对象中的旧 worktree 块形状（读入时 strip，不写入域模型）。 */
export type LegacyPersistWorktreeWireBlock = {
  readonly name: string;
  readonly type: "worktree";
  readonly role?: "user" | "assistant";
};

/** 是否为旧 persist worktree 块（读入 strip，不升迁 workplace）。 */
export function isLegacyWorktreeWireBlock(
  block: unknown,
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
  persist: Record<string, unknown>,
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
 */
export function normalizeAgentPromptLayoutDomain(
  layout: AgentPromptLayout,
): AgentPromptLayout {
  const persist = layout.persist.filter(
    (block): block is PersistTextPromptBlock =>
      (block as { type?: string }).type === "text",
  );
  return {
    ...(layout.system != null && layout.system.trim() !== ""
      ? { system: layout.system }
      : {}),
    ...(layout.persistEnabled === true ? { persistEnabled: true } : {}),
    ...(layout.dynamicEnabled === true ? { dynamicEnabled: true } : {}),
    ...(layoutHasWorkplace(layout) ? { workplace: layout.workplace } : {}),
    persist,
    dynamic: [...layout.dynamic],
  };
}
