/**
 * Prompt assembly context types (domain layer).
 *
 * @module domain/prompt/model/prompt-render-context
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import type { WorkplaceService } from "@/service/workplace/workplace.port.js";

/** Workplace + 会话消息 + VFS 上下文（dynamic 宏展开）。 */
export interface PromptRenderContext {
  readonly workplaceDisplay: string;
  readonly messages: readonly ChatMessage[];
  /** Defaults to `new Date()` when omitted (tests inject a fixed time). */
  readonly now?: Date;
  /** Workplace 服务，供 `{{$filetree}}` 实时渲染。 */
  readonly workplace?: WorkplaceService;
  /** Session VFS（其他调用方仍可传；`{{$filetree}}` 不再读取）。 */
  readonly vfs?: VfsService;
}

/** Structured input for model request services. */
export interface PromptLlmInput {
  readonly system?: string;
  readonly messages: readonly ChatMessage[];
}
