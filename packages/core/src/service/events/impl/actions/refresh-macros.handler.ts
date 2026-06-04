/**
 * refresh-macros event action: re-render worktree/filetree into session cache.
 *
 * @module service/events/impl/actions/refresh-macros.handler
 */

import type { SessionMacroCache } from "@/service/prompt/session-macro-cache.port.js";
import type { WorktreeService } from "@/service/worktree/worktree.port.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";

export interface RefreshMacrosHandlerDeps {
  readonly macroCache: SessionMacroCache;
  readonly worktree: (scope: VfsScope) => WorktreeService;
}

export async function runRefreshMacrosAction(
  projectId: string,
  sessionId: string,
  deps: RefreshMacrosHandlerDeps,
): Promise<void> {
  const wt = deps.worktree({
    kind: "session",
    projectId,
    sessionId,
  });
  await deps.macroCache.refresh(projectId, sessionId, () => wt.materialize());
}
