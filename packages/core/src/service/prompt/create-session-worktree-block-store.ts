/**
 * {@link DefaultSessionWorktreeBlockStore} 工厂。
 *
 * @module service/prompt/create-session-worktree-block-store
 */

import { DefaultSessionWorktreeBlockStore } from "./impl/session-worktree-block-store.service.js";
import type { SessionWorktreeBlockStore } from "./session-worktree-block.port.js";

/** 创建内存 Session worktree 块存储。 */
export function createSessionWorktreeBlockStore(): SessionWorktreeBlockStore {
  return new DefaultSessionWorktreeBlockStore();
}
