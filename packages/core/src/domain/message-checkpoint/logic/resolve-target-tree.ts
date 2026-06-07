/**
 * Resolves the rollback target checkpoint tree for an anchor message.
 *
 * @module domain/message-checkpoint/logic/resolve-target-tree
 */

import type { MessageCheckpointRepository } from "../repositories/message-checkpoint.port.js";

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
  anchorSeq: number,
): Promise<Map<string, number>> {
  const direct = await checkpoints.loadFileTree(sessionId, anchorMessageId);
  if (direct != null) {
    return direct;
  }

  const priorMessageId = await checkpoints.findCheckpointMessageIdAtOrBefore(
    sessionId,
    anchorSeq,
  );
  if (priorMessageId == null) {
    return new Map();
  }

  const prior = await checkpoints.loadFileTree(sessionId, priorMessageId);
  return prior ?? new Map();
}
