/**
 * 突变路径 head 快照与补偿回滚。
 *
 * @module domain/vfs/logic/restore-mutating-path-heads
 */

import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import { isVfsError } from "@/errors/vfs-errors.js";

/** 起始 head 快照：路径不存在。 */
export type MutatingPathHeadAbsent = {
  readonly kind: "absent";
  readonly path: string;
};

/** 起始 head 快照：路径存在。 */
export type MutatingPathHeadPresent = {
  readonly kind: "present";
  readonly path: string;
  readonly content: string;
  readonly version: number;
};

/** 单路径 head 快照。 */
export type MutatingPathHeadSnapshot =
  | MutatingPathHeadAbsent
  | MutatingPathHeadPresent;

/** restore 阶段聚合错误（spec：CompositeError 语义）。 */
export class MutatingPathRestoreCompositeError extends Error {
  readonly causes: readonly unknown[];

  constructor(causes: readonly unknown[]) {
    super("mutating path restore failed");
    this.name = "MutatingPathRestoreCompositeError";
    this.causes = causes;
  }
}

/**
 * 读取 mutating paths 当前 head，供 executeOp 失败时回滚。
 */
export async function captureMutatingPathHeadSnapshots(
  vfs: VfsService,
  paths: readonly string[],
): Promise<Map<string, MutatingPathHeadSnapshot>> {
  const snapshots = new Map<string, MutatingPathHeadSnapshot>();
  for (const path of paths) {
    try {
      const read = await vfs.read(path);
      snapshots.set(path, {
        kind: "present",
        path,
        content: read.content,
        version: read.version,
      });
    } catch (error: unknown) {
      if (isVfsError(error, "NOT_FOUND")) {
        snapshots.set(path, { kind: "absent", path });
        continue;
      }
      throw error;
    }
  }
  return snapshots;
}

/**
 * 将给定 paths 恢复为 snapshots 中记录的起始 head。
 */
export async function restoreMutatingPathHeads(
  vfs: VfsService,
  snapshots: ReadonlyMap<string, MutatingPathHeadSnapshot>,
  paths: readonly string[],
): Promise<void> {
  const errors: unknown[] = [];
  for (const path of paths) {
    const snapshot = snapshots.get(path);
    if (snapshot == null) {
      continue;
    }
    try {
      if (snapshot.kind === "absent") {
        try {
          await vfs.delete(path);
        } catch (error: unknown) {
          if (!isVfsError(error, "NOT_FOUND")) {
            throw error;
          }
        }
        continue;
      }
      await vfs.write(snapshot.path, snapshot.content, {
        versionCheck: false,
        expectedVersion: snapshot.version,
      });
    } catch (error: unknown) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new MutatingPathRestoreCompositeError(errors);
  }
}
