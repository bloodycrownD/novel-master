/**
 * Resolves the rollback target checkpoint tree for an anchor message.
 *
 * @module domain/message-checkpoint/logic/resolve-target-tree
 */

import type {
  CheckpointFilePointer,
  MessageCheckpointRepository,
} from "../repositories/message-checkpoint.port.js";

/**
 * 回滚 target 树解析结果。
 *
 * `tree` 是 `Map<logicalPath, version>`（reconcile / UI 友好形态）；
 * `entryIdByPath` 是 checkpoint 记录的旧 entryId——entry 行已被物理删除的
 * 路径（deleteWithRevision）靠它寻址 revision 并复活 entry
 * （rollback-restore-deleted-entry）。
 */
export type RollbackTargetTreeResolution = {
  readonly tree: Map<string, number>;
  readonly entryIdByPath: Map<string, number>;
};

/** checkpoint 指针树 → (version 树 + 旧 entryId 索引)。 */
function resolutionFromPointers(
  pointers: Map<string, CheckpointFilePointer> | null
): RollbackTargetTreeResolution {
  const tree = new Map<string, number>();
  const entryIdByPath = new Map<string, number>();
  if (pointers != null) {
    for (const [path, pointer] of pointers) {
      tree.set(path, pointer.revisionVersion);
      entryIdByPath.set(path, pointer.entryId);
    }
  }
  return { tree, entryIdByPath };
}

/**
 * Loads the target file tree for rollback.
 *
 * @remarks When the anchor has no checkpoint, uses the nearest prior checkpoint;
 *          when none exist, returns an empty tree (session baseline).
 */
export async function resolveRollbackTargetTree(
  checkpoints: MessageCheckpointRepository,
  sessionId: string,
  anchorMessageId: string,
  anchorSeq: number
): Promise<RollbackTargetTreeResolution> {
  const direct = await checkpoints.loadFilePointerTree(
    sessionId,
    anchorMessageId
  );
  if (direct != null) {
    return resolutionFromPointers(direct);
  }

  const priorMessageId = await checkpoints.findCheckpointMessageIdAtOrBefore(
    sessionId,
    anchorSeq
  );
  if (priorMessageId == null) {
    return resolutionFromPointers(null);
  }

  const prior = await checkpoints.loadFilePointerTree(sessionId, priorMessageId);
  return resolutionFromPointers(prior);
}

/**
 * 加载 `maxSeq` 及之前最近 checkpoint 的文件树（Undo Send prior-only 路径）。
 *
 * @remarks 不读取 anchor 自身 checkpoint；无 prior 时返回空树（会话基线）。
 */
export async function resolvePriorRollbackTargetTree(
  checkpoints: MessageCheckpointRepository,
  sessionId: string,
  maxSeq: number
): Promise<RollbackTargetTreeResolution> {
  const priorMessageId = await checkpoints.findCheckpointMessageIdAtOrBefore(
    sessionId,
    maxSeq
  );
  if (priorMessageId == null) {
    return resolutionFromPointers(null);
  }

  const prior = await checkpoints.loadFilePointerTree(sessionId, priorMessageId);
  return resolutionFromPointers(prior);
}
