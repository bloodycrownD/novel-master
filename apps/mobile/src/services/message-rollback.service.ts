/**
 * Thin wrapper for session message rollback (Core parity with CLI).
 */
import type {RollbackOptions} from '@novel-master/core/message-checkpoint';
import type {AppError, Result} from '@novel-master/core/errors';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

type RollbackScope = {readonly projectId: string; readonly sessionId: string};

export namespace MessageRollbackService {
  export async function rollback(runtime: MobileNovelMasterRuntime, scope: RollbackScope, messageId: string, options?: RollbackOptions): Promise<Result<void, AppError>> {
    return runtime.sessionFs.rollbackFilesToMessage(scope.sessionId, scope.projectId, messageId, options);
  }
}
