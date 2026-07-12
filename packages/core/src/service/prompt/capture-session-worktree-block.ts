/**
 * Session worktree 块门面：唯一生产写入路径。
 *
 * `SessionWorktreeBlockStore.capture` 仅允许在本模块与 store 实现内调用
 *（见 T-WEC17 `worktree-block-capture-allowlist.test.ts`）。
 * 应用层白名单入口均经 {@link captureSessionWorktreeBlock} /
 * {@link getCapturedBlockOrCapture}。
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

/**
 * 只读已 capture 块；无条目时显式 capture 一次（run / 预览读路径）。
 */
export async function getCapturedBlockOrCapture(
  scope: VfsScope,
  runtime: CaptureSessionWorktreeBlockRuntime,
): Promise<SessionWorktreeBlock> {
  if (scope.kind !== "session") {
    throw new SessionWorktreeBlockScopeError(
      "仅 session scope 可读取 worktree 块",
    );
  }

  const existing = runtime.worktreeBlockStore.getCapturedBlock(
    scope.projectId,
    scope.sessionId,
  );
  if (existing != null) {
    return existing;
  }

  return captureSessionWorktreeBlock(scope, runtime);
}
