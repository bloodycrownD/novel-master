/**
 * Session execute repository port.
 *
 * @module domain/session-fs/repositories/execute.port
 */

import type {
  SessionExecuteAction,
  SessionExecuteBatch,
  SessionExecuteCheckpoint,
} from "../model/execute-batch.js";

/** Persistence for execute batches, actions, and checkpoints. */
export interface SessionExecuteRepository {
  insertBatch(batch: SessionExecuteBatch): Promise<void>;

  insertAction(action: SessionExecuteAction): Promise<void>;

  insertCheckpoint(checkpoint: SessionExecuteCheckpoint): Promise<void>;

  listBatches(sessionId: string): Promise<SessionExecuteBatch[]>;

  findBatch(id: string): Promise<SessionExecuteBatch | null>;

  listCheckpoints(batchId: string): Promise<SessionExecuteCheckpoint[]>;

  listActions(batchId: string): Promise<SessionExecuteAction[]>;

  maxActionSeq(batchId: string): Promise<number>;

  deleteBatch(batchId: string): Promise<void>;

  deleteBySession(sessionId: string): Promise<void>;
}
