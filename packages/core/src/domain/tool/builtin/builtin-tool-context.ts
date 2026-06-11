/**
 * Shared context for all builtin agent tools.
 *
 * @module domain/tool/builtin/builtin-tool-context
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";

/** Runtime context injected into builtin tool `run()` handlers. */
export type BuiltinToolContext = {
  readonly vfs: VfsService;
  readonly projectId: string;
  readonly sessionId: string;
  /** Lists session messages including hidden rows (for chat_grep). */
  readonly listSessionMessages: () => Promise<readonly ChatMessage[]>;
};

/** @deprecated Use {@link BuiltinToolContext}. */
export type VfsToolContext = BuiltinToolContext;
