/**
 * 内置 Agent 工具共享上下文。
 *
 * @module domain/tool/builtin/builtin-tool-context
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";

/** 注入到内置工具 `run()` 的运行时上下文。 */
export type BuiltinToolContext = {
  readonly vfs: VfsService;
  readonly projectId: string;
  readonly sessionId: string;
  /** 列出会话消息（含 hidden，供 chat_grep）。 */
  readonly listSessionMessages: () => Promise<readonly ChatMessage[]>;
  /**
   * 可选：`write` 成功后 upsert `file_cache` `full:{path}`。
   * `edit` / delete / rename / move **不**读写此字段。
   */
  readonly sessionKkv?: SessionKkvService;
};

/** @deprecated Use {@link BuiltinToolContext}. */
export type VfsToolContext = BuiltinToolContext;
