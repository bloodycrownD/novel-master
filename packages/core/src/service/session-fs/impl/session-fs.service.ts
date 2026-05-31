/**
 * Default SessionFsService implementation.
 *
 * @module service/session-fs/impl/session-fs.service
 */

import { randomUUID } from "@/infra/random-uuid.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { VfsError, vfsNotFound } from "@/errors/vfs-errors.js";
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
    const batchId = randomUUID();
    const now = Date.now();
    const results: Array<SessionFsExecuteResult["results"][number]> = [];

    await this.deps.conn.transaction(async (tx) => {
      const vfs = this.scopedVfs(projectId, sessionId, tx);
      const snapshots = new SqliteSessionSnapshotRepository(tx);
      const execute = new SqliteSessionExecuteRepository(tx);

      await execute.insertBatch({
        id: batchId,
        sessionId,
        createdAtMs: now,
        createdBy: actor,
      });

      let seq = 0;
      const checkpointedPaths = new Set<string>();
      for (const action of actions) {
        if (action.function !== "read" && !checkpointedPaths.has(action.path)) {
          checkpointedPaths.add(action.path);
          const checkpointRev = await this.captureCheckpoint(
            sessionId,
            action.path,
            actor,
            vfs,
            now,
            snapshots,
          );
          await execute.insertCheckpoint({
            batchId,
            logicalPath: action.path,
            snapshotRev: checkpointRev,
            vfsVersion: await this.currentVfsVersion(vfs, action.path),
            createdAtMs: now,
            createdBy: actor,
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
            batchId,
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
            versionCheck,
            options?.expectedVersion,
          );
          await this.appendPostSnapshot(
            sessionId,
            action.path,
            action.content,
            "active",
            version,
            actor,
            now,
            snapshots,
          );
          results.push({
            function: "write",
            path: action.path,
            version,
          });
          await execute.insertAction({
            batchId,
            seq,
            function: "write",
            logicalPath: action.path,
            payloadJson: JSON.stringify({ content: action.content }),
          });
        } else {
          await this.appendPostSnapshot(
            sessionId,
            action.path,
            null,
            "deleted",
            null,
            actor,
            now,
            snapshots,
          );
          await vfs.delete(action.path);
          results.push({ function: "delete", path: action.path });
          await execute.insertAction({
            batchId,
            seq,
            function: "delete",
            logicalPath: action.path,
            payloadJson: null,
          });
        }
        seq++;
      }
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
    const checkpoints = await this.deps.execute.listCheckpoints(batchId);
    const checkpointByPath = new Map(
      checkpoints.map((cp) => [cp.logicalPath, cp]),
    );
    const actions = await this.deps.execute.listActions(batchId);

    await this.deps.conn.transaction(async (tx) => {
      const vfs = this.scopedVfs(projectId, sessionId, tx);
      const snapshots = new SqliteSessionSnapshotRepository(tx);
      const execute = new SqliteSessionExecuteRepository(tx);
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
          continue;
        }
        if (snap.status === "deleted" || snap.content == null) {
          try {
            await vfs.delete(action.logicalPath);
          } catch (error) {
            if (!(error instanceof VfsError) || error.code !== "NOT_FOUND") {
              throw error;
            }
          }
        } else {
          await vfs.write(action.logicalPath, snap.content, {
            versionCheck: false,
          });
        }
      }
      await snapshots.deleteAfterBatch(sessionId, batch.createdAtMs);
      await execute.deleteBatch(batchId);
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
        if (!(error instanceof VfsError) || error.code !== "NOT_FOUND") {
          throw error;
        }
      }
    } else {
      await vfs.write(logicalPath, snap.content, { versionCheck: false });
    }
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
      if (error instanceof VfsError && error.code === "NOT_FOUND") {
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
      if (error instanceof VfsError && error.code === "NOT_FOUND") {
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
      if (error instanceof VfsError && error.code === "NOT_FOUND") {
        const result = await vfs.write(path, content);
        return result.version;
      }
      throw error;
    }
  }
}
