/**
 * 消息 checkpoint 与回滚服务的公开入口。
 *
 * @module public/message-checkpoint
 */

export {
  isRollbackVfsDegradableError,
  isRollbackRevisionBackfillRequiredError,
  readRollbackRevisionBackfillMissingPaths,
} from "../domain/message-checkpoint/logic/rollback-error-guards.js";
export { MessageCheckpointFactory } from "../service/message-checkpoint/message-checkpoint-factory.js";
export type { MessageCheckpointService } from "../service/message-checkpoint/message-checkpoint.port.js";
export type {
  MessageRollbackService,
  RollbackOptions,
} from "../service/message-checkpoint/message-rollback.port.js";
