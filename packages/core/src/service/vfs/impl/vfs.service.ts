/**
 * Default VFS application service implementation.
 *
 * entry_id 化后实现 {@link InternalVfsService}（scopeKey + 纯逻辑路径），所有 repo
 * 调用带 scopeKey 透传。`resetHeadToVersion` 维持 unsupported 抛错（无 revision 层）；
 * `hardDelete` 维持走 `delete`；`renamePath` / `renamePrefix` 抛 unsupported（§D）。
 *
 * @module service/vfs/impl/vfs.service
 */

import { ensureParentDirectories } from "@/domain/vfs/logic/ensure-parent-dirs.js";
import {
  isStorageRootParent,
  parentDir,
} from "@/domain/vfs/logic/parent-dir.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { computeReplaceResult } from "@/domain/vfs/logic/compute-replace-result.js";
import {
  VfsError,
  vfsAlreadyExists,
  vfsInvalidPath,
  vfsIsDirectory,
  vfsNotADirectory,
  vfsNotFound,
  vfsParentNotFound,
} from "@/errors/vfs-errors.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import { matchGlob } from "../glob-match.js";
import type {
  VfsGrepMatch,
  VfsGrepOptions,
  VfsListEntry,
  VfsReadResult,
  WriteOptions,
} from "../internal-vfs.port.js";
import type { InternalVfsService } from "../internal-vfs.port.js";
import { grepContents } from "@/domain/vfs/logic/vfs-grep.js";

/**
 * VFS service delegating persistence to {@link VfsEntryRepository}.
 */
export class DefaultVfsService implements InternalVfsService {
  constructor(private readonly repo: VfsEntryRepository) {}

  async list(
    scopeKey: string,
    dir: string,
    options?: { recursive?: boolean; maxDepth?: number },
  ): Promise<VfsListEntry[]> {
    const normalized = normalizePath(dir);
    const entries = await this.repo.list(scopeKey, normalized, options);
    if (normalized !== "/" && !isStorageRootParent(normalized)) {
      const entry = await this.repo.findByPath(scopeKey, normalized);
      // 虚拟 storage root 无目录行时视为空目录，与 mkdir 豁免一致
      if (entry == null && entries.length === 0) {
        throw vfsNotFound(normalized);
      }
    }
    return entries;
  }

  async mkdir(scopeKey: string, path: string): Promise<void> {
    const normalized = normalizePath(path);
    if (normalized === "/") {
      throw vfsInvalidPath(path, "cannot mkdir root");
    }

    const existing = await this.repo.findByPath(scopeKey, normalized);
    if (existing != null) {
      throw vfsAlreadyExists(normalized);
    }

    const parent = parentDir(normalized);
    if (parent !== "/" && !isStorageRootParent(parent)) {
      const parentEntry = await this.repo.findByPath(scopeKey, parent);
      if (parentEntry == null) {
        throw vfsParentNotFound(parent);
      }
      if (parentEntry.entryKind !== "directory") {
        throw vfsNotADirectory(parent);
      }
    }

    await this.repo.insertDirectory(scopeKey, normalized);
  }

  async read(scopeKey: string, path: string): Promise<VfsReadResult> {
    const entry = await this.repo.findByPath(scopeKey, path);
    if (entry == null) {
      throw vfsNotFound(path);
    }
    if (entry.entryKind === "directory") {
      throw vfsIsDirectory(path);
    }
    return {
      path: entry.path,
      content: entry.content,
      version: entry.version,
      mtimeMs: entry.mtimeMs,
    };
  }

  async write(
    scopeKey: string,
    path: string,
    content: string,
    options?: WriteOptions,
  ): Promise<{ version: number }> {
    const normalized = normalizePath(path);
    const existing = await this.repo.findByPath(scopeKey, normalized);
    if (existing?.entryKind === "directory") {
      throw vfsIsDirectory(normalized);
    }
    if (existing == null) {
      await ensureParentDirectories(this.repo, scopeKey, normalized);
      return this.repo.insert(scopeKey, normalized, content);
    }

    const versionCheck = options?.versionCheck !== false;
    if (versionCheck && options?.expectedVersion == null) {
      throw new VfsError(
        "CONFLICT",
        `expectedVersion required when updating ${normalized}`,
        { path: normalized },
      );
    }
    return this.repo.update(scopeKey, normalized, content, {
      expectedVersion: options?.expectedVersion,
      versionCheck,
    });
  }

  async replace(
    scopeKey: string,
    path: string,
    oldString: string,
    newString: string,
    options?: { replaceAll?: boolean },
  ): Promise<{ version: number; replacements: number }> {
    const current = await this.read(scopeKey, path);
    const { nextContent, replacements } = computeReplaceResult(
      path,
      current.content,
      oldString,
      newString,
      options,
    );

    const result = await this.repo.update(scopeKey, path, nextContent, {
      expectedVersion: current.version,
      versionCheck: true,
    });
    return { version: result.version, replacements };
  }

  async glob(
    scopeKey: string,
    pattern: string,
    options?: { cwd?: string },
  ): Promise<string[]> {
    const paths = await this.repo.listAllPaths(scopeKey);
    const cwd = options?.cwd;

    const matched = paths.filter((entryPath) => {
      if (cwd != null && !pathUnderDir(entryPath, cwd)) {
        return false;
      }
      return matchGlob(pattern, entryPath);
    });

    matched.sort();
    return matched;
  }

  async grep(
    scopeKey: string,
    pattern: string,
    options?: VfsGrepOptions,
  ): Promise<VfsGrepMatch[]> {
    const rows = await this.repo.scanContents(scopeKey, options?.pathPrefix);
    const filtered =
      options?.pathGlob != null
        ? rows.filter((row) => matchGlob(options.pathGlob!, row.path))
        : rows;
    return grepContents(filtered, pattern, options);
  }

  delete(
    scopeKey: string,
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    const normalized = normalizePath(path);
    if (normalized === "/") {
      throw vfsInvalidPath(path, "cannot delete root");
    }
    return this.repo.delete(scopeKey, normalized, {
      recursive: options?.recursive === true,
    });
  }

  async resetHeadToVersion(
    scopeKey: string,
    path: string,
    _version: number,
  ): Promise<void> {
    // 无 revision 层：补偿合同依赖 revision，禁止静默 no-op
    throw new Error(
      `resetHeadToVersion is unsupported without revision history: ${scopeKey}:${path}`,
    );
  }

  hardDelete(
    scopeKey: string,
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    // 无墓碑可 append 时与物理 delete 一致
    return this.delete(scopeKey, path, options);
  }

  renamePath(
    _scopeKey: string,
    fromLogical: string,
    _toLogical: string,
    _options?: { overwrite?: boolean },
  ): Promise<void> {
    // rename 原语依赖事务 + repo + scopeKey，本服务只拿 repo 不在事务里跑；
    // 生产 wiring 走 RevisionAwareVfsService，不会命中此分支。
    throw new Error(
      `renamePath is unsupported without revision history: ${fromLogical}`,
    );
  }

  renamePrefix(
    _scopeKey: string,
    oldDirLogical: string,
    _newDirLogical: string,
  ): Promise<void> {
    throw new Error(
      `renamePrefix is unsupported without revision history: ${oldDirLogical}`,
    );
  }
}

function pathUnderDir(entryPath: string, dir: string): boolean {
  if (dir === "/") {
    return true;
  }
  return entryPath === dir || entryPath.startsWith(`${dir}/`);
}
