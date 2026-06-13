/**
 * {@link DefaultSessionWorktreeSnapshotStore} 工厂。
 *
 * @module service/prompt/create-session-worktree-snapshot-store
 */

import { DefaultSessionWorktreeSnapshotStore } from "./impl/session-worktree-snapshot-store.service.js";
import type { SessionWorktreeSnapshotStore } from "./session-worktree-snapshot.port.js";

/** 创建内存 Session worktree 快照存储。 */
export function createSessionWorktreeSnapshotStore(): SessionWorktreeSnapshotStore {
  return new DefaultSessionWorktreeSnapshotStore();
}
