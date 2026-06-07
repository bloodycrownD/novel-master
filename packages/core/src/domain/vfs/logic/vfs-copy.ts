/**
 * VFS path copy via {@link VfsService} composition (files and recursive directory trees).
 *
 * @module domain/vfs/logic/vfs-copy
 */

import { VfsError, vfsNotFound } from "@/errors/vfs-errors.js";
import type { VfsService } from "../ports/vfs-service.port.js";
import {
  mkdirIgnoreExists,
  normalizeDirPath,
  remapPathUnderDir,
} from "./vfs-move.js";

export type CopyVfsPathOptions = {
  readonly recursive?: boolean;
};

/**
 * Copy a file or directory tree (source is never deleted).
 *
 * @remarks
 * Directory copy requires `options.recursive: true` (default false).
 * File vs directory detection matches {@link moveVfsPath}.
 */
export async function copyVfsPath(
  vfs: VfsService,
  from: string,
  to: string,
  options?: CopyVfsPathOptions,
): Promise<void> {
  const recursive = options?.recursive ?? false;

  try {
    const existing = await vfs.read(from);
    await vfs.write(to, existing.content, { versionCheck: false });
    return;
  } catch (error) {
    if (!(error instanceof VfsError)) {
      throw error;
    }
    if (error.code !== "NOT_FOUND" && error.code !== "IS_DIRECTORY") {
      throw error;
    }
  }

  const oldDir = normalizeDirPath(from);
  const entries = await vfs.list(oldDir, { recursive: true });
  const hasDirRow = entries.some(
    (e) => e.kind === "directory" && e.path === oldDir,
  );
  if (entries.length === 0 && !hasDirRow) {
    throw vfsNotFound(from);
  }

  if (!recursive) {
    throw new VfsError(
      "IS_DIRECTORY",
      `Directory copy requires recursive: true: ${from}`,
      { path: from },
    );
  }

  const newDir = normalizeDirPath(to);
  const dirs = entries
    .filter((e) => e.kind === "directory")
    .sort((a, b) => a.path.length - b.path.length);
  const files = entries.filter((e) => e.kind === "file");

  await mkdirIgnoreExists(vfs, newDir);
  for (const dir of dirs) {
    await mkdirIgnoreExists(vfs, remapPathUnderDir(dir.path, oldDir, newDir));
  }

  for (const file of files) {
    const content = await vfs.read(file.path);
    await vfs.write(
      remapPathUnderDir(file.path, oldDir, newDir),
      content.content,
      { versionCheck: false },
    );
  }
}
