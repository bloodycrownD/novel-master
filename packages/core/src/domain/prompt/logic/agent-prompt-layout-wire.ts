/**
 * Agent Prompt 布局 wire 序列化（persist / dynamic 块 → wire map 值）。
 *
 * @module domain/prompt/logic/agent-prompt-layout-wire
 */

import type {
  DynamicPromptBlock,
  PersistPromptBlock,
} from "../model/agent-prompt-layout.js";

/** persist 文本块 wire 形状。 */
export type PersistTextBlockWire = {
  readonly type: "text";
  readonly role: "user" | "assistant";
  readonly content: string;
};

/** persist worktree 块 wire 形状。 */
export type PersistWorktreeBlockWire = {
  readonly type: "worktree";
  readonly role: "user" | "assistant";
};

/** persist 块 wire 形状。 */
export type PersistPromptBlockWire =
  | PersistTextBlockWire
  | PersistWorktreeBlockWire;

/** dynamic 块 wire 形状。 */
export type DynamicPromptBlockWire = {
  readonly type: "text";
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly lifecycle?: "once";
};

/**
 * 将 persist 区块序列化为 wire map 条目。
 */
export function persistBlockToWire(
  block: PersistPromptBlock,
): PersistPromptBlockWire {
  if (block.type === "worktree") {
    return { type: "worktree", role: block.role ?? "user" };
  }
  return { type: "text", role: block.role, content: block.content };
}

/**
 * 将 dynamic 区块序列化为 wire map 条目。
 *
 * @remarks 仅 `lifecycle: "once"` 写入 wire；缺省 always 省略字段。
 */
export function dynamicBlockToWire(
  block: DynamicPromptBlock,
): DynamicPromptBlockWire {
  return {
    type: "text",
    role: block.role,
    content: block.content,
    ...(block.lifecycle === "once" ? { lifecycle: "once" as const } : {}),
  };
}
