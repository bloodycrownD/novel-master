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

/** 起始 head 快照：目录（含子树文件内容）。 */
export type MutatingPathHeadDirectory = {
  readonly kind: "directory";
  readonly path: string;
  readonly files: readonly {
    readonly path: string;
    readonly content: string;
    readonly version: number;
  }[];
};

/** 单路径 head 快照。 */
export type MutatingPathHeadSnapshot =
  | MutatingPathHeadAbsent
  | MutatingPathHeadPresent
  | MutatingPathHeadDirectory;

/** restore 阶段聚合错误（spec：CompositeError 语义）。 */
export class MutatingPathRestoreCompositeError extends Error {
  readonly causes: readonly unknown[];

  constructor(causes: readonly unknown[]) {
    super("mutating path restore failed");
    this.name = "MutatingPathRestoreCompositeError";
    this.causes = causes;
  }
}

async function captureDirectorySnapshot(
  vfs: VfsService,
  path: string,
): Promise<MutatingPathHeadDirectory> {
  const entries = await vfs.list(path, { recursive: true });
  const files: MutatingPathHeadDirectory["files"][number][] = [];
  for (const entry of entries) {
    if (entry.kind !== "file") {
      continue;
    }
    const read = await vfs.read(entry.path);
    files.push({
      path: entry.path,
      content: read.content,
      version: read.version,
    });
  }
  return { kind: "directory", path, files };
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
        const entries = await vfs.list(path, { recursive: true });
        if (entries.length > 0) {
          snapshots.set(path, await captureDirectorySnapshot(vfs, path));
        } else {
          snapshots.set(path, { kind: "absent", path });
        }
        continue;
      }
      if (isVfsError(error, "IS_DIRECTORY")) {
        snapshots.set(path, await captureDirectorySnapshot(vfs, path));
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
          await vfs.delete(path, { recursive: true });
        } catch (error: unknown) {
          if (!isVfsError(error, "NOT_FOUND")) {
            throw error;
          }
        }
        continue;
      }
      if (snapshot.kind === "directory") {
        try {
          await vfs.delete(path, { recursive: true });
        } catch (error: unknown) {
          if (!isVfsError(error, "NOT_FOUND")) {
            throw error;
          }
        }
        if (snapshot.files.length === 0) {
          await vfs.mkdir(path);
          continue;
        }
        for (const file of snapshot.files) {
          await vfs.write(file.path, file.content, { versionCheck: false });
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
