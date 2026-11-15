/**
 * 突变路径 head 快照与补偿回滚。
 *
 * @module domain/vfs/logic/restore-mutating-path-heads
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import type { VfsListEntry } from "../model/vfs-list-entry.js";

/** 起始 head 快照：路径不存在。 */
type MutatingPathHeadAbsent = {
  readonly kind: "absent";
  readonly path: string;
};

/** 起始 head 快照：路径存在。 */
type MutatingPathHeadPresent = {
  readonly kind: "present";
  readonly path: string;
  readonly content: string;
  readonly version: number;
};

/** 起始 head 快照：目录（含子树文件 head version）。 */
type MutatingPathHeadDirectory = {
  readonly kind: "directory";
  readonly path: string;
  readonly files: readonly {
    readonly path: string;
    readonly version: number;
  }[];
};

/** 单路径 head 快照。 */
type MutatingPathHeadSnapshot = MutatingPathHeadAbsent | MutatingPathHeadPresent | MutatingPathHeadDirectory;

/** restore 阶段聚合错误（保留 CompositeError 的多 cause 语义）。 */
export class MutatingPathRestoreCompositeError extends AppError<"VFS_RESTORE_FAILED"> {
  readonly causes: readonly unknown[];

  constructor(causes: readonly unknown[]) {
    super("VFS_RESTORE_FAILED", { detail: "mutating path restore failed", causes });
    this.name = "MutatingPathRestoreCompositeError";
    this.causes = causes;
  }
}

/**
 * 由已 list 出的 entries 直接采集目录快照，避免逐文件 read。
 *
 * @remarks 回滚只依赖 version（见 {@link restoreDirectorySnapshot}），
 * 故 list 返回的 head_version 已足够，不必再 read 正文。
 */
function captureDirectorySnapshot(path: string, entries: readonly VfsListEntry[]): MutatingPathHeadDirectory {
  const files: MutatingPathHeadDirectory["files"][number][] = [];
  for (const entry of entries) {
    if (entry.kind !== "file") {
      continue;
    }
    if (entry.version == null) {
      continue;
    }
    files.push({
      path: entry.path,
      version: entry.version,
    });
  }
  return { kind: "directory", path, files };
}

/**
 * 读取 mutating paths 当前 head，供 executeOp 失败时回滚。
 */
export async function captureMutatingPathHeadSnapshots(vfs: VfsService, paths: readonly string[]): Promise<Result<Map<string, MutatingPathHeadSnapshot>, AppError>> {
  const snapshots = new Map<string, MutatingPathHeadSnapshot>();
  for (const path of paths) {
    const read = await vfs.read(path);
    if (read.ok) {
      snapshots.set(path, {
        kind: "present",
        path,
        content: read.value.content,
        version: read.value.version,
      });
      continue;
    }
    // IS_DIRECTORY：路径有 directory 行（空目录也是真实目录），采集子树文件 head。
    if (read.error.key === "VFS_IS_DIRECTORY") {
      const entries = await vfs.list(path, { recursive: true });
      if (!entries.ok) return Result.err(entries.error);
      snapshots.set(path, captureDirectorySnapshot(path, entries.value));
      continue;
    }
    if (read.error.key !== "VFS_NOT_FOUND") {
      return Result.err(read.error);
    }
    const entries = await vfs.list(path, { recursive: true });
    if (entries.ok) {
      if (entries.value.length > 0) {
        snapshots.set(path, captureDirectorySnapshot(path, entries.value));
      } else {
        snapshots.set(path, { kind: "absent", path });
      }
      continue;
    }
    if (entries.error.key !== "VFS_NOT_FOUND") {
      return Result.err(entries.error);
    }
    snapshots.set(path, { kind: "absent", path });
  }
  return Result.ok(snapshots);
}

/**
 * directory 补偿：快照外 hardDelete + 快照内 resetHead（禁 write 注水）。
 */
async function restoreDirectorySnapshot(vfs: VfsService, snapshot: MutatingPathHeadDirectory): Promise<Result<void, AppError>> {
  // 空目录：硬清 D 下残留文件/子树后，确保目录存在
  if (snapshot.files.length === 0) {
    const wiped = await vfs.hardDelete(snapshot.path, { recursive: true });
    if (!wiped.ok && wiped.error.key !== "VFS_NOT_FOUND") return Result.err(wiped.error);
    const made = await vfs.mkdir(snapshot.path);
    if (!made.ok && made.error.key !== "VFS_ALREADY_EXISTS") return Result.err(made.error);
    return Result.ok(undefined);
  }

  // list 遇 NOT_FOUND ≡ 无快照外文件
  let currentFilePaths: string[] = [];
  const listed = await vfs.list(snapshot.path, { recursive: true });
  if (listed.ok) {
    currentFilePaths = listed.value.filter((entry) => entry.kind === "file").map((entry) => entry.path);
  } else if (listed.error.key !== "VFS_NOT_FOUND") {
    return Result.err(listed.error);
  }

  const snapshotPaths = new Set(snapshot.files.map((file) => file.path));
  for (const filePath of currentFilePaths) {
    if (snapshotPaths.has(filePath)) {
      continue;
    }
    const wiped = await vfs.hardDelete(filePath, { recursive: true });
    if (!wiped.ok && wiped.error.key !== "VFS_NOT_FOUND") return Result.err(wiped.error);
  }

  // 快照内只用 version 拨回
  for (const file of snapshot.files) {
    const reset = await vfs.resetHeadToVersion(file.path, file.version);
    if (!reset.ok) return Result.err(reset.error);
  }
  return Result.ok(undefined);
}

/**
 * 将给定 paths 恢复为 snapshots 中记录的起始 head。
 *
 * @remarks 走 resetHeadToVersion / hardDelete 补偿原语，禁止 write 注水；
 *   多路径失败聚合成 `VFS_RESTORE_FAILED`（保留 CompositeError 的多 cause 语义）。
 */
export async function restoreMutatingPathHeads(vfs: VfsService, snapshots: ReadonlyMap<string, MutatingPathHeadSnapshot>, paths: readonly string[]): Promise<Result<void, AppError>> {
  const errors: unknown[] = [];
  for (const path of paths) {
    const snapshot = snapshots.get(path);
    if (snapshot == null) {
      continue;
    }
    if (snapshot.kind === "absent") {
      const wiped = await vfs.hardDelete(path, { recursive: true });
      if (!wiped.ok && wiped.error.key !== "VFS_NOT_FOUND") errors.push(wiped.error);
      continue;
    }
    if (snapshot.kind === "directory") {
      const restored = await restoreDirectorySnapshot(vfs, snapshot);
      if (!restored.ok) errors.push(restored.error);
      continue;
    }
    const reset = await vfs.resetHeadToVersion(snapshot.path, snapshot.version);
    if (!reset.ok) errors.push(reset.error);
  }
  if (errors.length > 0) {
    return Result.err(new MutatingPathRestoreCompositeError(errors));
  }
  return Result.ok(undefined);
}
