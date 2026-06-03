/**
 * Default SessionFsService implementation.
 *
 * @module service/session-fs/impl/session-fs.service
 */

import { randomUUID } from "@/infra/random-uuid.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { isVfsError, vfsNotFound } from "@/errors/vfs-errors.js";
import {
  sessionFsRollbackLegacyBatch,
  sessionFsRollbackMessageNotFound,
  sessionFsRollbackMessageSessionMismatch,
  sessionFsRollbackSnapshotMissing,
} from "@/errors/session-fs-errors.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import type { SessionExecuteRepository } from "@/domain/session-fs/repositories/execute.port.js";
import type { SessionSnapshotRepository } from "@/domain/session-fs/repositories/snapshot.port.js";
import { SqliteSessionSnapshotRepository } from "@/domain/session-fs/repositories/impl/sqlite-snapshot.repository.js";
import { SqliteSessionExecuteRepository } from "@/domain/session-fs/repositories/impl/sqlite-execute.repository.js";
import { createScopedVfsService } from "@/service/vfs/create-scoped-vfs-service.js";
import type { VfsService } from "@/service/vfs/vfs.port.js";
import type {
  SessionFsAction,
  SessionFsActor,
  SessionFsBatchSummary,
  SessionFsExecuteOptions,
  SessionFsExecuteResult,
  SessionFsService,
  SessionFsSnapshotSummary,
} from "../session-fs.port.js";

/** Dependencies for {@link DefaultSessionFsService}. */
export interface SessionFsServiceDeps {
  readonly conn: TdbcConnection;
  readonly snapshots: SessionSnapshotRepository;
  readonly execute: SessionExecuteRepository;
  readonly messages: MessageRepository;
}

interface RunActionsCtx {
  readonly sessionId: string;
  readonly projectId: string;
  readonly batchId: string;
  readonly actor: SessionFsActor;
  readonly versionCheck: boolean;
  readonly expectedVersion?: number;
  readonly startSeq: number;
}

/**
 * Session file execute with checkpoints and path-level snapshots.
 */
export class DefaultSessionFsService implements SessionFsService {
  constructor(private readonly deps: SessionFsServiceDeps) {}

  async execute(
    sessionId: string,
    projectId: string,
    actions: SessionFsAction[],
    actor: SessionFsActor,
    options?: SessionFsExecuteOptions,
  ): Promise<SessionFsExecuteResult> {
    const versionCheck = options?.versionCheck !== false;
    const continueBatchId = options?.continueBatchId;
    const now = Date.now();
    let batchId: string;
    let startSeq = 0;

    if (continueBatchId != null && continueBatchId !== "") {
      const existing = await this.deps.execute.findBatch(continueBatchId);
      if (existing == null || existing.sessionId !== sessionId) {
        throw vfsNotFound(continueBatchId);
      }
      batchId = continueBatchId;
      startSeq = (await this.deps.execute.maxActionSeq(batchId)) + 1;
    } else {
      batchId = randomUUID();
    }

    const results: Array<SessionFsExecuteResult["results"][number]> = [];

    await this.deps.conn.transaction(async (tx) => {
      const execute = new SqliteSessionExecuteRepository(tx);
      if (continueBatchId == null || continueBatchId === "") {
        await execute.insertBatch({
          id: batchId,
          sessionId,
          createdAtMs: now,
          createdBy: actor,
          messageId: options?.messageId ?? null,
        });
      }
      const batchResults = await this.runActionsInTx(tx, {
        sessionId,
        projectId,
        batchId,
        actor,
        versionCheck,
        expectedVersion: options?.expectedVersion,
        startSeq,
      }, actions);
      results.push(...batchResults);
    });

    return { batchId, results };
  }

  async listBatches(sessionId: string): Promise<SessionFsBatchSummary[]> {
    const batches = await this.deps.execute.listBatches(sessionId);
    return batches.map((b) => ({
      id: b.id,
      sessionId: b.sessionId,
      createdAtMs: b.createdAtMs,
      createdBy: b.createdBy,
      messageId: b.messageId ?? null,
    }));
  }

  async rollbackBatch(
    sessionId: string,
    projectId: string,
    batchId: string,
  ): Promise<void> {
    const batch = await this.deps.execute.findBatch(batchId);
    if (batch == null || batch.sessionId !== sessionId) {
      throw vfsNotFound(batchId);
    }

    await this.deps.conn.transaction(async (tx) => {
      await this.rollbackBatchInTx(tx, sessionId, projectId, batchId, batch.createdAtMs);
    });
  }

  /**
   * Rolls back batches for messages after the anchor, then truncates the chat tail.
   * Batches are undone newest-first inside one transaction so snapshot cleanup stays consistent.
   */
  async rollbackToMessage(
    sessionId: string,
    projectId: string,
    messageId: string,
  ): Promise<void> {
    const anchor = await this.deps.messages.findById(messageId);
    if (anchor == null) {
      throw sessionFsRollbackMessageNotFound(messageId);
    }
    if (anchor.sessionId !== sessionId) {
      throw sessionFsRollbackMessageSessionMismatch(messageId, sessionId);
    }

    const allMessages = await this.deps.messages.listBySession(sessionId);
    const tail = allMessages.filter((m) => m.seq > anchor.seq);
    const tailMessageIds = new Set(tail.map((m) => m.id));

    const batches = await this.deps.execute.listBatches(sessionId);
    const toRollback = batches.filter(
      (b) => b.messageId != null && tailMessageIds.has(b.messageId),
    );

    // Legacy batches (no message_id) after the anchor with mutating actions block message rollback.
    for (const b of batches) {
      if (b.messageId != null) {
        continue;
      }
      if (b.createdAtMs <= anchor.createdAtMs) {
        continue;
      }
      const actions = await this.deps.execute.listActions(b.id);
      if (actions.some((a) => a.function !== "read")) {
        throw sessionFsRollbackLegacyBatch(sessionId);
      }
    }

    const sorted = [...toRollback].sort(
      (a, b) => b.createdAtMs - a.createdAtMs,
    );

    await this.deps.conn.transaction(async (tx) => {
      for (const batch of sorted) {
        await this.rollbackBatchInTx(
          tx,
          sessionId,
          projectId,
          batch.id,
          batch.createdAtMs,
        );
      }
      const messages = new SqliteMessageRepository(tx);
      await messages.deleteAfterSeq(sessionId, anchor.seq);
    });
  }

  async listSnapshots(
    sessionId: string,
    logicalPath: string,
  ): Promise<SessionFsSnapshotSummary[]> {
    const rows = await this.deps.snapshots.listByPath(sessionId, logicalPath);
    return rows.map((s) => ({
      snapshotRev: s.snapshotRev,
      status: s.status,
      vfsVersion: s.vfsVersion,
      createdAtMs: s.createdAtMs,
      createdBy: s.createdBy,
    }));
  }

  async rollbackSnapshot(
    sessionId: string,
    projectId: string,
    logicalPath: string,
    snapshotRev: number,
  ): Promise<void> {
    const snap = await this.deps.snapshots.findByRev(
      sessionId,
      logicalPath,
      snapshotRev,
    );
    if (snap == null) {
      throw vfsNotFound(logicalPath);
    }
    const vfs = this.scopedVfs(projectId, sessionId);
    if (snap.status === "deleted" || snap.content == null) {
      try {
        await vfs.delete(logicalPath);
      } catch (error) {
        if (!isVfsError(error, "NOT_FOUND")) {
          throw error;
        }
      }
    } else {
      await vfs.write(logicalPath, snap.content, { versionCheck: false });
    }
  }

  private async runActionsInTx(
    tx: TdbcConnection,
    ctx: RunActionsCtx,
    actions: SessionFsAction[],
  ): Promise<SessionFsExecuteResult["results"]> {
    const vfs = this.scopedVfs(ctx.projectId, ctx.sessionId, tx);
    const snapshots = new SqliteSessionSnapshotRepository(tx);
    const execute = new SqliteSessionExecuteRepository(tx);
    const results: SessionFsExecuteResult["results"][number][] = [];
    const now = Date.now();
    let seq = ctx.startSeq;
    const existingCheckpoints = await execute.listCheckpoints(ctx.batchId);
    const checkpointedPaths = new Set(
      existingCheckpoints.map((cp) => cp.logicalPath),
    );

    for (const action of actions) {
      if (action.function !== "read" && !checkpointedPaths.has(action.path)) {
        checkpointedPaths.add(action.path);
        const checkpointRev = await this.captureCheckpoint(
          ctx.sessionId,
          action.path,
          ctx.actor,
          vfs,
          now,
          snapshots,
        );
        await execute.insertCheckpoint({
          batchId: ctx.batchId,
          logicalPath: action.path,
          snapshotRev: checkpointRev,
          vfsVersion: await this.currentVfsVersion(vfs, action.path),
          createdAtMs: now,
          createdBy: ctx.actor,
        });
      }

      if (action.function === "read") {
        const read = await vfs.read(action.path);
        results.push({
          function: "read",
          path: action.path,
          content: read.content,
        });
        await execute.insertAction({
          batchId: ctx.batchId,
          seq,
          function: "read",
          logicalPath: action.path,
          payloadJson: null,
        });
      } else if (action.function === "write") {
        const version = await this.autoWrite(
          vfs,
          action.path,
          action.content,
          ctx.versionCheck,
          ctx.expectedVersion,
        );
        await this.appendPostSnapshot(
          ctx.sessionId,
          action.path,
          action.content,
          "active",
          version,
          ctx.actor,
          now,
          snapshots,
        );
        results.push({
          function: "write",
          path: action.path,
          version,
        });
        await execute.insertAction({
          batchId: ctx.batchId,
          seq,
          function: "write",
          logicalPath: action.path,
          payloadJson: JSON.stringify({ content: action.content }),
        });
      } else {
        await this.appendPostSnapshot(
          ctx.sessionId,
          action.path,
          null,
          "deleted",
          null,
          ctx.actor,
          now,
          snapshots,
        );
        await vfs.delete(action.path);
        results.push({ function: "delete", path: action.path });
        await execute.insertAction({
          batchId: ctx.batchId,
          seq,
          function: "delete",
          logicalPath: action.path,
          payloadJson: null,
        });
      }
      seq++;
    }

    return results;
  }

  private async rollbackBatchInTx(
    tx: TdbcConnection,
    sessionId: string,
    projectId: string,
    batchId: string,
    batchCreatedAtMs: number,
  ): Promise<void> {
    const execute = new SqliteSessionExecuteRepository(tx);
    const snapshots = new SqliteSessionSnapshotRepository(tx);
    const checkpoints = await execute.listCheckpoints(batchId);
    const checkpointByPath = new Map(
      checkpoints.map((cp) => [cp.logicalPath, cp]),
    );
    const actions = await execute.listActions(batchId);
    const vfs = this.scopedVfs(projectId, sessionId, tx);
    const mutableActions = [...actions].reverse();

    for (const action of mutableActions) {
      if (action.function === "read") {
        continue;
      }
      const cp = checkpointByPath.get(action.logicalPath);
      if (cp == null) {
        continue;
      }
      const snap = await snapshots.findByRev(
        sessionId,
        action.logicalPath,
        cp.snapshotRev,
      );
      if (snap == null) {
        throw sessionFsRollbackSnapshotMissing(batchId, action.logicalPath);
      }
      if (snap.status === "deleted" || snap.content == null) {
        try {
          await vfs.delete(action.logicalPath);
        } catch (error) {
          if (!isVfsError(error, "NOT_FOUND")) {
            throw error;
          }
        }
      } else {
        await vfs.write(action.logicalPath, snap.content, {
          versionCheck: false,
        });
      }
    }
    await snapshots.deleteAfterBatch(sessionId, batchCreatedAtMs);
    await execute.deleteBatch(batchId);
  }

  private scopedVfs(
    projectId: string,
    sessionId: string,
    conn: TdbcConnection = this.deps.conn,
  ): VfsService {
    return createScopedVfsService(conn, {
      kind: "session",
      projectId,
      sessionId,
    });
  }

  private async currentVfsVersion(
    vfs: VfsService,
    path: string,
  ): Promise<number | null> {
    try {
      const read = await vfs.read(path);
      return read.version;
    } catch (error) {
      if (isVfsError(error, "NOT_FOUND")) {
        return null;
      }
      throw error;
    }
  }

  private async captureCheckpoint(
    sessionId: string,
    logicalPath: string,
    actor: SessionFsActor,
    vfs: VfsService,
    now: number,
    snapshots: SessionSnapshotRepository,
  ): Promise<number> {
    try {
      const read = await vfs.read(logicalPath);
      const rev = await snapshots.nextRev(sessionId, logicalPath);
      await snapshots.insert({
        sessionId,
        logicalPath,
        snapshotRev: rev,
        content: read.content,
        status: "active",
        vfsVersion: read.version,
        createdAtMs: now,
        createdBy: actor,
      });
      return rev;
    } catch (error) {
      if (isVfsError(error, "NOT_FOUND")) {
        const rev = await snapshots.nextRev(sessionId, logicalPath);
        await snapshots.insert({
          sessionId,
          logicalPath,
          snapshotRev: rev,
          content: null,
          status: "deleted",
          vfsVersion: null,
          createdAtMs: now,
          createdBy: actor,
        });
        return rev;
      }
      throw error;
    }
  }

  private async appendPostSnapshot(
    sessionId: string,
    logicalPath: string,
    content: string | null,
    status: "active" | "deleted",
    vfsVersion: number | null,
    actor: SessionFsActor,
    now: number,
    snapshots: SessionSnapshotRepository,
  ): Promise<void> {
    const rev = await snapshots.nextRev(sessionId, logicalPath);
    await snapshots.insert({
      sessionId,
      logicalPath,
      snapshotRev: rev,
      content,
      status,
      vfsVersion,
      createdAtMs: now,
      createdBy: actor,
    });
  }

  private async autoWrite(
    vfs: VfsService,
    path: string,
    content: string,
    versionCheck: boolean,
    expectedVersion?: number,
  ): Promise<number> {
    if (!versionCheck) {
      const result = await vfs.write(path, content, { versionCheck: false });
      return result.version;
    }
    if (expectedVersion != null) {
      const result = await vfs.write(path, content, { expectedVersion });
      return result.version;
    }
    try {
      const current = await vfs.read(path);
      const result = await vfs.write(path, content, {
        expectedVersion: current.version,
      });
      return result.version;
    } catch (error) {
      if (isVfsError(error, "NOT_FOUND")) {
        const result = await vfs.write(path, content);
        return result.version;
      }
      throw error;
    }
  }
}
