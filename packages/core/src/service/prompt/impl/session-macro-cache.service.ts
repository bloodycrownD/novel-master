/**
 * In-memory session macro cache (worktree + filetree display strings).
 *
 * @module service/prompt/impl/session-macro-cache.service
 */

import type { WorktreeListRow } from "@/domain/worktree/model/worktree-types.js";
import type {
  SessionMacroCache,
  SessionMacroSnapshot,
} from "../session-macro-cache.port.js";

function cacheKey(projectId: string, sessionId: string): string {
  return `${projectId}\0${sessionId}`;
}

export class DefaultSessionMacroCache implements SessionMacroCache {
  private readonly store = new Map<string, SessionMacroSnapshot>();

  get(projectId: string, sessionId: string): SessionMacroSnapshot | undefined {
    return this.store.get(cacheKey(projectId, sessionId));
  }

  async refresh(
    projectId: string,
    sessionId: string,
    render: () => Promise<{
      readonly worktreeDisplay: string;
      readonly filetreeDisplay: string;
      readonly listRows: readonly WorktreeListRow[];
    }>,
  ): Promise<SessionMacroSnapshot> {
    const { worktreeDisplay, filetreeDisplay, listRows } = await render();
    const snapshot: SessionMacroSnapshot = {
      worktreeDisplay,
      filetreeDisplay,
      listRows,
      refreshedAtMs: Date.now(),
    };
    this.store.set(cacheKey(projectId, sessionId), snapshot);
    return snapshot;
  }

  clear(projectId: string, sessionId: string): void {
    this.store.delete(cacheKey(projectId, sessionId));
  }
}
