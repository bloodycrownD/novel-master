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
        try {
          const entries = await vfs.list(path, { recursive: true });
          if (entries.length > 0) {
            snapshots.set(path, await captureDirectorySnapshot(vfs, path));
          } else {
            snapshots.set(path, { kind: "absent", path });
          }
        } catch (listError: unknown) {
          if (isVfsError(listError, "NOT_FOUND")) {
            snapshots.set(path, { kind: "absent", path });
          } else {
            throw listError;
          }
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
 * directory 补偿：快照外 hardDelete + 快照内 resetHead（禁 write 注水）。
 */
async function restoreDirectorySnapshot(
  vfs: VfsService,
  snapshot: MutatingPathHeadDirectory,
): Promise<void> {
  // 空目录：硬清 D 下残留文件/子树后，确保目录存在
  if (snapshot.files.length === 0) {
    try {
      await vfs.hardDelete(snapshot.path, { recursive: true });
    } catch (error: unknown) {
      if (!isVfsError(error, "NOT_FOUND")) {
        throw error;
      }
    }
    try {
      await vfs.mkdir(snapshot.path);
    } catch (error: unknown) {
      if (!isVfsError(error, "ALREADY_EXISTS")) {
        throw error;
      }
    }
    return;
  }

  // list 遇 NOT_FOUND ≡ 无快照外文件
  let currentFilePaths: string[] = [];
  try {
    const entries = await vfs.list(snapshot.path, { recursive: true });
    currentFilePaths = entries
      .filter((entry) => entry.kind === "file")
      .map((entry) => entry.path);
  } catch (error: unknown) {
    if (!isVfsError(error, "NOT_FOUND")) {
      throw error;
    }
  }

  const snapshotPaths = new Set(snapshot.files.map((file) => file.path));
  for (const filePath of currentFilePaths) {
    if (snapshotPaths.has(filePath)) {
      continue;
    }
    try {
      await vfs.hardDelete(filePath, { recursive: true });
    } catch (error: unknown) {
      if (!isVfsError(error, "NOT_FOUND")) {
        throw error;
      }
    }
  }

  // 快照内只用 version 拨回；content 字段仅为 capture 遗留
  for (const file of snapshot.files) {
    await vfs.resetHeadToVersion(file.path, file.version);
  }
}

/**
 * 将给定 paths 恢复为 snapshots 中记录的起始 head。
 *
 * @remarks 走 resetHeadToVersion / hardDelete 补偿原语，禁止 write 注水。
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
          await vfs.hardDelete(path, { recursive: true });
        } catch (error: unknown) {
          if (!isVfsError(error, "NOT_FOUND")) {
            throw error;
          }
        }
        continue;
      }
      if (snapshot.kind === "directory") {
        await restoreDirectorySnapshot(vfs, snapshot);
        continue;
      }
      await vfs.resetHeadToVersion(snapshot.path, snapshot.version);
    } catch (error: unknown) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new MutatingPathRestoreCompositeError(errors);
  }
}
