/**
 * 消息 checkpoint 与回滚服务的公开入口。
 *
 * @module public/message-checkpoint
 */

export {
  createMessageCheckpointService,
  createMessageRollbackService,
} from "../service/message-checkpoint/create-message-checkpoint-services.js";
export type { MessageCheckpointService } from "../service/message-checkpoint/message-checkpoint.port.js";
export type {
  MessageRollbackService,
  RollbackOptions,
} from "../service/message-checkpoint/message-rollback.port.js";
