/**
 * Session-scoped worktree/filetree macro cache port.
 *
 * @module service/prompt/session-macro-cache.port
 */

import type { WorktreeListRow } from "@/domain/worktree/model/worktree-types.js";

export interface SessionMacroSnapshot {
  readonly worktreeDisplay: string;
  readonly filetreeDisplay: string;
  readonly listRows: readonly WorktreeListRow[];
  readonly refreshedAtMs: number;
}

export interface SessionMacroCache {
  get(projectId: string, sessionId: string): SessionMacroSnapshot | undefined;
  refresh(
    projectId: string,
    sessionId: string,
    render: () => Promise<{
      readonly worktreeDisplay: string;
      readonly filetreeDisplay: string;
      readonly listRows: readonly WorktreeListRow[];
    }>,
  ): Promise<SessionMacroSnapshot>;
  clear(projectId: string, sessionId: string): void;
}
