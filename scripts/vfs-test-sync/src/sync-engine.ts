import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { VfsError, type VfsService } from "@novel-master/core";
import type { SyncConfig } from "./config.js";
import { MirrorError } from "./errors.js";
import { walkMirror } from "./mirror-walk.js";
import { toMirrorFile, toMirrorRelative, toVfsPath } from "./path-map.js";

/** Wraps mirror filesystem IO so main can exit 1 with a clear message (I1). */
async function mirrorIo<T>(
  action: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    if (err instanceof MirrorError) {
      throw err;
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new MirrorError(`mirror ${action} failed: ${detail}`, { cause: err });
  }
}

/** Summary counters for verbose logging and tests. */
export interface SyncStats {
  written: number;
  deleted: number;
}

/**
 * Force-sync VFS → mirror: write all prefix paths to disk, delete disk orphans.
 */
export async function push(
  vfs: VfsService,
  config: SyncConfig,
): Promise<SyncStats> {
  const stats: SyncStats = { written: 0, deleted: 0 };
  const { mirrorRoot, prefix, verbose } = config;

  await mirrorIo("mkdir", () => mkdir(mirrorRoot, { recursive: true }));

  const pathsVfs = await vfs.glob("**/*", { cwd: prefix });
  const vfsSet = new Set(pathsVfs);

  for (const vfsPath of pathsVfs) {
    const rel = toMirrorRelative(prefix, vfsPath);
    if (rel == null) {
      continue;
    }
    const { content } = await vfs.read(vfsPath);
    const filePath = toMirrorFile(mirrorRoot, rel);
    await mirrorIo(`mkdir ${rel}`, () =>
      mkdir(dirname(filePath), { recursive: true }),
    );
    await mirrorIo(`write ${rel}`, () => writeFile(filePath, content, "utf8"));
    stats.written++;
    if (verbose) {
      console.error(`push: write ${rel}`);
    }
  }

  const pathsDisk = await walkMirror(mirrorRoot);
  for (const rel of pathsDisk) {
    const vfsPath = toVfsPath(prefix, rel);
    if (!vfsSet.has(vfsPath)) {
      await mirrorIo(`delete ${rel}`, () =>
        unlink(toMirrorFile(mirrorRoot, rel)),
      );
      stats.deleted++;
      if (verbose) {
        console.error(`push: delete orphan ${rel}`);
      }
    }
  }

  return stats;
}

/**
 * Force-sync mirror → VFS: write all mirror files to VFS, delete VFS orphans.
 * Updates use `versionCheck: false` to force overwrite existing paths.
 */
export async function pull(
  vfs: VfsService,
  config: SyncConfig,
): Promise<SyncStats> {
  const stats: SyncStats = { written: 0, deleted: 0 };
  const { mirrorRoot, prefix, verbose } = config;

  const pathsDisk = await walkMirror(mirrorRoot);
  const diskVfsPaths = new Set<string>();

  for (const rel of pathsDisk) {
    const vfsPath = toVfsPath(prefix, rel);
    diskVfsPaths.add(vfsPath);
    const content = await mirrorIo(`read ${rel}`, () =>
      readFile(toMirrorFile(mirrorRoot, rel), "utf8"),
    );

    let exists = true;
    try {
      await vfs.read(vfsPath);
    } catch (err: unknown) {
      if (err instanceof VfsError && err.code === "NOT_FOUND") {
        exists = false;
      } else {
        throw err;
      }
    }

    if (exists) {
      await vfs.write(vfsPath, content, { versionCheck: false });
    } else {
      await vfs.write(vfsPath, content);
    }
    stats.written++;
    if (verbose) {
      console.error(`pull: write ${vfsPath}`);
    }
  }

  const pathsVfs = await vfs.glob("**/*", { cwd: prefix });
  for (const vfsPath of pathsVfs) {
    if (!diskVfsPaths.has(vfsPath)) {
      await vfs.delete(vfsPath);
      stats.deleted++;
      if (verbose) {
        console.error(`pull: delete orphan ${vfsPath}`);
      }
    }
  }

  return stats;
}

/** Engine surface used by watch scheduling. */
export interface SyncEngine {
  push(): Promise<SyncStats>;
  pull(): Promise<SyncStats>;
}

/** Builds push/pull closures bound to a VFS instance and config. */
export function createSyncEngine(
  vfs: VfsService,
  config: SyncConfig,
): SyncEngine {
  return {
    push: () => push(vfs, config),
    pull: () => pull(vfs, config),
  };
}
