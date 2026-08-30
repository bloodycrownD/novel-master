/**
 * 合成 md 树的 Phase A 相对路径校验（不对合成树套 ZIP basename / validateVfsZipEntries）。
 *
 * @module domain/character-card/logic/validate-md-tree-paths
 */

import { characterCardError } from "@/errors/character-card-errors.js";
import { VFS_ZIP_MAX_ENTRY_PATH_LEN } from "@/domain/vfs/logic/vfs-zip-validate.js";
import {
  assertLogicalPathAllowed,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import {
  logicalFromZipEntryRelativeToDirectory,
  resolveZipDirectoryPath,
} from "@/domain/vfs/logic/vfs-zip-path.js";
import type { MdTree } from "../model/character-card.js";

const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[\\/]/;

/**
 * 校验单个相对路径 key（无 leading `/`）。
 *
 * @throws {import("@/errors/character-card-errors.js").CharacterCardError} `INVALID_PATH`
 */
export function assertMdTreeRelativePathAllowed(relativePath: string): void {
  if (relativePath.length === 0) {
    throw characterCardError("INVALID_PATH", "empty relative path in md tree");
  }
  if (relativePath.startsWith("/")) {
    throw characterCardError(
      "INVALID_PATH",
      `leading slash in md tree path: ${relativePath}`
    );
  }
  if (relativePath.includes("\\")) {
    throw characterCardError(
      "INVALID_PATH",
      `backslash in md tree path: ${relativePath}`
    );
  }
  if (relativePath.length > VFS_ZIP_MAX_ENTRY_PATH_LEN) {
    throw characterCardError(
      "INVALID_PATH",
      `md tree path exceeds ${VFS_ZIP_MAX_ENTRY_PATH_LEN} characters: ${relativePath}`
    );
  }
  if (WINDOWS_DRIVE_PATH.test(relativePath)) {
    throw characterCardError(
      "INVALID_PATH",
      `absolute Windows path in md tree: ${relativePath}`
    );
  }

  const segments = relativePath.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      throw characterCardError(
        "INVALID_PATH",
        `empty segment in md tree path: ${relativePath}`
      );
    }
    if (segment === "..") {
      throw characterCardError(
        "INVALID_PATH",
        `parent segment in md tree path: ${relativePath}`
      );
    }
  }
}

/**
 * Phase A：校验整棵 md 树相对路径，并返回拼好的逻辑绝对路径 → 正文。
 *
 * **不调用** `assertZipEntriesNotDomainRootPrefixed` / `validateVfsZipEntries`。
 */
export function validateMdTreeForImport(
  scope: VfsScope,
  tree: MdTree,
  directoryPath: string
): ReadonlyMap<string, string> {
  const targetDir = resolveZipDirectoryPath(directoryPath);
  const files = new Map<string, string>();

  for (const [relativePath, content] of tree) {
    assertMdTreeRelativePathAllowed(relativePath);
    let logical: string;
    try {
      logical = logicalFromZipEntryRelativeToDirectory(relativePath, targetDir);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "invalid relative path";
      throw characterCardError("INVALID_PATH", message);
    }
    try {
      assertLogicalPathAllowed(scope, logical);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "path not allowed for scope";
      throw characterCardError(
        "INVALID_PATH",
        `md tree "${relativePath}" → logical "${logical}": ${message}`
      );
    }
    files.set(logical, content);
  }

  return files;
}
