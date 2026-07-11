/**
 * 共享 capture helper：session scope 物化并写入 block store。
 *
 * @module service/prompt/capture-session-worktree-block
 */

import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { WorktreeService } from "@/service/worktree/worktree.port.js";
import type {
  SessionWorktreeBlock,
  SessionWorktreeBlockStore,
} from "./session-worktree-block.port.js";

/** 非 session scope 时抛出。 */
export class SessionWorktreeBlockScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionWorktreeBlockScopeError";
  }
}

/** {@link captureSessionWorktreeBlock} 所需的最小 runtime 契约。 */
export interface CaptureSessionWorktreeBlockRuntime {
  readonly worktree: (scope: VfsScope) => WorktreeService;
  readonly worktreeBlockStore: SessionWorktreeBlockStore;
}

/**
 * 校验 session scope → 物化持久块 → 写入 block store。
 * 返回刚写入的块（含 `capturedAtMs`）。
 */
export async function captureSessionWorktreeBlock(
  scope: VfsScope,
  runtime: CaptureSessionWorktreeBlockRuntime,
): Promise<SessionWorktreeBlock> {
  if (scope.kind !== "session") {
    throw new SessionWorktreeBlockScopeError(
      "仅 session scope 可 capture worktree 块",
    );
  }

  const wt = runtime.worktree(scope);
  const { worktreeDisplay } = await wt.materializePersistBlock();
  runtime.worktreeBlockStore.capture(scope.projectId, scope.sessionId, {
    worktreeDisplay,
  });

  const block = runtime.worktreeBlockStore.getCapturedBlock(
    scope.projectId,
    scope.sessionId,
  );
  if (block == null) {
    throw new Error("capture 后 block store 无条目");
  }
  return block;
}
