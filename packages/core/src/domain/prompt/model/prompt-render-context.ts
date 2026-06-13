/**
 * Prompt assembly context types (domain layer).
 *
 * @module domain/prompt/model/prompt-render-context
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";

/** Worktree + 会话消息 + VFS 上下文（dynamic 宏展开）。 */
export interface PromptRenderContext {
  readonly worktreeDisplay: string;
  readonly messages: readonly ChatMessage[];
  /** Defaults to `new Date()` when omitted (tests inject a fixed time). */
  readonly now?: Date;
  /** Session VFS，供 `{{$filetree}}` 实时渲染。 */
  readonly vfs?: VfsService;
}

/** Structured input for model request services. */
export interface PromptLlmInput {
  readonly system?: string;
  readonly messages: readonly ChatMessage[];
}
