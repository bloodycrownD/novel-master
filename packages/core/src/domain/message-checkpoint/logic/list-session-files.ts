/**
 * Lists session-scoped live file heads for checkpoint capture.
 *
 * @module domain/message-checkpoint/logic/list-session-files
 */

import {
  scopePhysicalPrefix,
  toLogicalPath,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { SessionFileHead } from "../model/message-checkpoint.js";

/**
 * Scans the session work tree for file entries (excludes empty directories).
 */
export async function listSessionFileHeads(
  entryRepo: VfsEntryRepository,
  projectId: string,
  sessionId: string,
): Promise<SessionFileHead[]> {
  const scope: VfsScope = {
    kind: "session",
    projectId,
    sessionId,
  };
  const prefix = scopePhysicalPrefix(scope);
  const heads = await entryRepo.listFileHeadsUnderPrefix(prefix);
  return heads.map((head) => ({
    logicalPath: toLogicalPath(scope, head.path),
    headVersion: head.headVersion,
  }));
}
