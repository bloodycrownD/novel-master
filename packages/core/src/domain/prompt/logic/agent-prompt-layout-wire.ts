/**
 * Agent Prompt 布局 wire 序列化（persist / dynamic 块 → wire map 值）。
 *
 * @module domain/prompt/logic/agent-prompt-layout-wire
 */

import type {
  DynamicPromptBlock,
  PersistTextPromptBlock,
} from "../model/agent-prompt-layout.js";

/** persist 文本块 wire 形状。 */
export type PersistTextBlockWire = {
  readonly type: "text";
  readonly role: "user" | "assistant";
  readonly content: string;
};

/** persist 块 wire 形状（仅 text）。 */
export type PersistPromptBlockWire = PersistTextBlockWire;

/** dynamic 块 wire 形状。 */
export type DynamicPromptBlockWire = {
  readonly type: "text";
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly lifecycle?: "once";
};

/**
 * 将 persist 文本块序列化为 wire map 条目。
 */
export function persistBlockToWire(
  block: PersistTextPromptBlock,
): PersistPromptBlockWire {
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
