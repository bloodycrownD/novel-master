/**
 * 内存 Session worktree 块存储。
 *
 * @module service/prompt/impl/session-worktree-block-store.service
 */

import type {
  SessionWorktreeBlock,
  SessionWorktreeBlockStore,
} from "../session-worktree-block.port.js";

function cacheKey(projectId: string, sessionId: string): string {
  return `${projectId}\0${sessionId}`;
}

export class DefaultSessionWorktreeBlockStore
  implements SessionWorktreeBlockStore
{
  private readonly store = new Map<string, SessionWorktreeBlock>();

  capture(
    projectId: string,
    sessionId: string,
    block: { readonly worktreeDisplay: string },
  ): void {
    this.store.set(cacheKey(projectId, sessionId), {
      worktreeDisplay: block.worktreeDisplay,
      capturedAtMs: Date.now(),
    });
  }

  getCapturedBlock(
    projectId: string,
    sessionId: string,
  ): SessionWorktreeBlock | undefined {
    return this.store.get(cacheKey(projectId, sessionId));
  }

  clear(projectId: string, sessionId: string): void {
    this.store.delete(cacheKey(projectId, sessionId));
  }
}
