/**
 * Lists session-scoped live file heads for checkpoint capture.
 *
 * entry_id 化后按 `scope_key` 扫描，直接返回纯逻辑 path + entry_id（不再做物理前缀映射）。
 *
 * @module domain/message-checkpoint/logic/list-session-files
 */

import { LogicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { SessionFileHead } from "../model/message-checkpoint.js";

export const SessionFiles = {
  /**
   * Scans the session work tree for file entries (excludes empty directories).
   */
  async listHeads(entryRepo: VfsEntryRepository, projectId: string, sessionId: string): Promise<SessionFileHead[]> {
    const scopeKeyStr = LogicalPath.scopeKey({ kind: "session", projectId, sessionId });
    const heads = await entryRepo.listFileHeadsUnderPrefix(scopeKeyStr, "/");
    return heads.map((head) => ({
      entryId: head.entryId,
      logicalPath: head.path,
      headVersion: head.headVersion,
    }));
  },
} as const;
