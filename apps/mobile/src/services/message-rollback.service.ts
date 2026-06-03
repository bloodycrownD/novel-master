/**
 * Thin wrapper for session message rollback (Core parity with CLI).
 */
import type {MobileNovelMasterRuntime} from '../runtime/types';

export async function rollbackToMessage(
  runtime: MobileNovelMasterRuntime,
  scope: {readonly projectId: string; readonly sessionId: string},
  messageId: string,
): Promise<void> {
  await runtime.sessionFs.rollbackToMessage(
    scope.sessionId,
    scope.projectId,
    messageId,
  );
}
