/**
 * Thin wrapper for session message rollback (Core parity with CLI).
 */
import type {RollbackOptions} from '@novel-master/core/message-checkpoint';
import type {AppError, Result} from '@novel-master/core/errors';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

export async function rollbackToMessage(
  runtime: MobileNovelMasterRuntime,
  scope: {readonly projectId: string; readonly sessionId: string},
  messageId: string,
  options?: RollbackOptions,
): Promise<Result<void, AppError>> {
  return runtime.sessionFs.rollbackToMessage(
    scope.sessionId,
    scope.projectId,
    messageId,
    options,
  );
}
