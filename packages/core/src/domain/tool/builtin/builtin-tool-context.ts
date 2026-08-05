/**
 * 内置 Agent 工具共享上下文。
 *
 * @module domain/tool/builtin/builtin-tool-context
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";

/**
 * 资源配额占位（A-14）。
 *
 * @remarks
 * 目前只定义语义、不做强制；后续在 `ToolRunner` / 内置工具里挂上真正的扣减逻辑。
 * `maxWriteBytes` 限制单个 turn 内 write/edit 的累计写入字节；
 * `maxCalls` 限制单个 turn 内 tool 调用总数。
 */
export interface ToolResourceQuota {
  readonly maxWriteBytes?: number;
  readonly maxCalls?: number;
}

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
  /**
   * 可选：VFS 内允许访问的路径前缀白名单（A-14 path policy）。
   *
   * @remarks
   * 语义是「VFS 内相对 session root 的绝对路径前缀」——例如 `"src/"`、
   * `"docs/notes"`。`ToolRunner.call()` 在 schema 校验通过之后、真正调用
   * tool 之前会做一次二次校验：从 input 里取出 `path` / `filePath` /
   * `from` / `to` 字段，只要任一路径不在任一前缀下就拒绝（抛 FORBIDDEN）。
   *
   * `undefined` 表示不限制（向后兼容）——目前三端 runtime 都按这个语义走，
   * 后续可以在 cli / desktop / mobile 各自的装配点收紧到具体白名单。
   */
  readonly allowedPaths?: readonly string[];
  /**
   * 可选：资源配额占位（A-14）。当前仅占位，`ToolRunner` 还未真正强制。
   */
  readonly resourceQuota?: ToolResourceQuota;
};

/** @deprecated Use {@link BuiltinToolContext}. */
export type VfsToolContext = BuiltinToolContext;
