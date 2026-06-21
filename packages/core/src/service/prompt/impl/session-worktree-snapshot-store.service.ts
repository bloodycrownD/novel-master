/**
 * 内存 Session worktree 快照存储。
 *
 * @module service/prompt/impl/session-worktree-snapshot-store.service
 */

import type {
  SessionWorktreeSnapshot,
  SessionWorktreeSnapshotStore,
} from "../session-worktree-snapshot.port.js";

function cacheKey(projectId: string, sessionId: string): string {
  return `${projectId}\0${sessionId}`;
}

interface CacheEntry {
  snapshot: SessionWorktreeSnapshot;
  dirty: boolean;
}

export class DefaultSessionWorktreeSnapshotStore
  implements SessionWorktreeSnapshotStore
{
  private readonly store = new Map<string, CacheEntry>();

  get(projectId: string, sessionId: string): SessionWorktreeSnapshot | undefined {
    return this.store.get(cacheKey(projectId, sessionId))?.snapshot;
  }

  markDirty(projectId: string, sessionId: string): void {
    const key = cacheKey(projectId, sessionId);
    const entry = this.store.get(key);
    if (entry != null) {
      entry.dirty = true;
      return;
    }
    this.store.set(key, {
      snapshot: {
        worktreeDisplay: "",
        refreshedAtMs: 0,
      },
      dirty: true,
    });
  }

  isDirty(projectId: string, sessionId: string): boolean {
    return this.store.get(cacheKey(projectId, sessionId))?.dirty === true;
  }

  async getOrRefresh(
    projectId: string,
    sessionId: string,
    render: () => Promise<{ readonly worktreeDisplay: string }>,
  ): Promise<SessionWorktreeSnapshot> {
    const key = cacheKey(projectId, sessionId);
    const entry = this.store.get(key);
    if (entry != null && !entry.dirty) {
      return entry.snapshot;
    }

    const { worktreeDisplay } = await render();
    const snapshot: SessionWorktreeSnapshot = {
      worktreeDisplay,
      refreshedAtMs: Date.now(),
    };
    this.store.set(key, { snapshot, dirty: false });
    return snapshot;
  }

  clear(projectId: string, sessionId: string): void {
    this.store.delete(cacheKey(projectId, sessionId));
  }
}
