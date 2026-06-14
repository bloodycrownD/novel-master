/**
 * Agent Prompt 三区布局模型（system + persist + dynamic）。
 *
 * @module domain/prompt/model/agent-prompt-layout
 */

import type { PromptBlockLifecycle } from "./prompt-block.js";

/** persist 区文本块（user | assistant）。 */
export type PersistTextPromptBlock = {
  readonly name: string;
  readonly type: "text";
  readonly role: "user" | "assistant";
  readonly content: string;
};

/** persist 区 worktree 块（至多一个）。 */
export type PersistWorktreePromptBlock = {
  readonly name: string;
  readonly type: "worktree";
  /** wire 缺省时视为 user。 */
  readonly role?: "user" | "assistant";
};

/** persist 区块：text 或 worktree。 */
export type PersistPromptBlock =
  | PersistTextPromptBlock
  | PersistWorktreePromptBlock;

/** dynamic 区文本块（允许宏与 lifecycle）。 */
export type DynamicPromptBlock = {
  readonly name: string;
  readonly type: "text";
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly lifecycle?: PromptBlockLifecycle;
};

/**
 * Agent Prompt 布局（替代扁平 {@link PromptBlock}[]）。
 * chat 为运行时槽位，不出现在配置中。
 */
export interface AgentPromptLayout {
  /** 可选单段 system；映射到 API `system` 字段。 */
  readonly system?: string;
  readonly persist: readonly PersistPromptBlock[];
  readonly dynamic: readonly DynamicPromptBlock[];
}
