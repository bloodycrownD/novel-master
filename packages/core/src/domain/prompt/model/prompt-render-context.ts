/**
 * Prompt assembly context types (domain layer).
 *
 * @module domain/prompt/model/prompt-render-context
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";

/** Worktree + message context for prompt macro expansion. */
export interface PromptRenderContext {
  readonly worktreeDisplay: string;
  /** ASCII tree from worktree file tree; macro `{{.filetree}}`. */
  readonly filetreeDisplay: string;
  readonly messages: readonly ChatMessage[];
  /** Defaults to `new Date()` when omitted (tests inject a fixed time). */
  readonly now?: Date;
}

/** Structured input for model request services. */
export interface PromptLlmInput {
  readonly system?: string;
  readonly messages: readonly ChatMessage[];
}
