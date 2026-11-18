/**
 * Default VFS application service implementation.
 *
 * entry_id 化后实现 {@link InternalVfsService}（scopeKey + 纯逻辑路径），所有 repo
 * 调用带 scopeKey 透传。`resetHeadToVersion` 维持 unsupported 失败（无 revision 层）；
 * `hardDelete` 维持走 `delete`；`renamePath` / `renamePrefix` 失败 unsupported（§D）。
 *
 * @module service/vfs/impl/vfs.service
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { ParentDirs } from "@/domain/vfs/logic/ensure-parent-dirs.js";
import { ParentDir } from "@/domain/vfs/logic/parent-dir.js";
import { EntryNameValidator } from "@/domain/vfs/logic/validate-entry-name.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsContentSize } from "@/domain/vfs/model/vfs-content-size.js";
import { ReplaceResult } from "@/domain/vfs/logic/compute-replace-result.js";
import { PathNormalizer } from "@/domain/vfs/repositories/impl/normalize-path.js";
import { matchGlob } from "../glob-match.js";
import type { VfsGrepMatch, VfsGrepOptions, VfsListEntry, VfsReadResult } from "../internal-vfs.port.js";
import type { InternalVfsService } from "../internal-vfs.port.js";
import { VfsGrep } from "@/domain/vfs/logic/vfs-grep.js";

/**
 * VFS service delegating persistence to {@link VfsEntryRepository}.
 */
export class DefaultVfsService implements InternalVfsService {
  constructor(private readonly repo: VfsEntryRepository) {}

  async list(scopeKey: string, dir: string, options?: { recursive?: boolean; maxDepth?: number }): Promise<Result<VfsListEntry[], AppError>> {
    const resolved = PathNormalizer.normalize(dir);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    const entries = await this.repo.list(scopeKey, normalized, options);
    if (!entries.ok) return entries;
    if (normalized !== "/") {
      const rootParent = ParentDir.isStorageRoot(normalized);
      if (!rootParent.ok) return Result.err(rootParent.error);
      if (!rootParent.value) {
        const entry = await this.repo.findByPath(scopeKey, normalized);
        if (!entry.ok) return Result.err(entry.error);
        // 虚拟 storage root 无目录行时视为空目录，与 mkdir 豁免一致
        if (entry.value == null && entries.value.length === 0) {
          return Result.err(new AppError("VFS_NOT_FOUND", {path: normalized, detail: `Path not found: ${normalized}`}));
        }
      }
    }
    return Result.ok(entries.value);
  }

  async mkdir(scopeKey: string, path: string): Promise<Result<void, AppError>> {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    if (normalized === "/") {
      return Result.err(new AppError("VFS_INVALID_PATH", {path, reason: "cannot mkdir root", detail: `Invalid path ${path}: cannot mkdir root`}));
    }
    const nameCheck = EntryNameValidator.assertValid(normalized);
    if (!nameCheck.ok) return nameCheck;

    const existing = await this.repo.findByPath(scopeKey, normalized);
    if (!existing.ok) return Result.err(existing.error);
    if (existing.value != null) {
      return Result.err(new AppError("VFS_ALREADY_EXISTS", {path: normalized, detail: `Path already exists: ${normalized}`}));
    }

    const parent = ParentDir.resolve(normalized);
    if (!parent.ok) return Result.err(parent.error);
    if (parent.value !== "/") {
      const parentIsRoot = ParentDir.isStorageRoot(parent.value);
      if (!parentIsRoot.ok) return Result.err(parentIsRoot.error);
      if (!parentIsRoot.value) {
        const parentEntry = await this.repo.findByPath(scopeKey, parent.value);
        if (!parentEntry.ok) return Result.err(parentEntry.error);
        if (parentEntry.value == null) {
          return Result.err(new AppError("VFS_PARENT_NOT_FOUND", {path: parent.value, detail: `Parent not found: ${parent.value}`}));
        }
        if (parentEntry.value.entryKind !== "directory") {
          return Result.err(new AppError("VFS_NOT_A_DIRECTORY", {path: parent.value, detail: `Not a directory: ${parent.value}`}));
        }
      }
    }

    const inserted = await this.repo.insertDirectory(scopeKey, normalized);
    if (!inserted.ok) return inserted;
    return Result.ok(undefined);
  }

  async read(scopeKey: string, path: string): Promise<Result<VfsReadResult, AppError>> {
    const entry = await this.repo.findByPath(scopeKey, path);
    if (!entry.ok) return Result.err(entry.error);
    if (entry.value == null) {
      return Result.err(new AppError("VFS_NOT_FOUND", {path, detail: `Path not found: ${path}`}));
    }
    if (entry.value.entryKind === "directory") {
      return Result.err(new AppError("VFS_IS_DIRECTORY", {path, detail: `Path is a directory: ${path}`}));
    }
    return Result.ok({
      path: entry.value.path,
      content: entry.value.content,
      version: entry.value.version,
      mtimeMs: entry.value.mtimeMs,
    });
  }

  async findContentSize(scopeKey: string, path: string): Promise<Result<VfsContentSize | null, AppError>> {
    return this.repo.findContentSizeByPath(scopeKey, path);
  }

  async write(scopeKey: string, path: string, content: string): Promise<Result<{ version: number }, AppError>> {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    const existing = await this.repo.findByPath(scopeKey, normalized);
    if (!existing.ok) return Result.err(existing.error);
    if (existing.value?.entryKind === "directory") {
      return Result.err(new AppError("VFS_IS_DIRECTORY", {path: normalized, detail: `Path is a directory: ${normalized}`}));
    }
    if (existing.value == null) {
      // 只拦「创建」：存量条目（含 zip 导入的历史名）内容更新不重新审判名字
      const nameCheck = EntryNameValidator.assertValid(normalized);
      if (!nameCheck.ok) return Result.err(nameCheck.error);
      const parentCheck = await ParentDirs.ensure(this.repo, scopeKey, normalized);
      if (!parentCheck.ok) return Result.err(parentCheck.error);
      return this.repo.insert(scopeKey, normalized, content);
    }
    return this.repo.update(scopeKey, normalized, content, existing.value.version + 1);
  }

  async replace(scopeKey: string, path: string, oldString: string, newString: string, options?: { replaceAll?: boolean }): Promise<Result<{ version: number; replacements: number }, AppError>> {
    const current = await this.read(scopeKey, path);
    if (!current.ok) return Result.err(current.error);
    const computed = ReplaceResult.compute(path, current.value.content, oldString, newString, options);
    if (!computed.ok) return Result.err(computed.error);
    const { nextContent, replacements } = computed.value;

    const result = await this.repo.update(scopeKey, path, nextContent, current.value.version + 1);
    if (!result.ok) return Result.err(result.error);
    return Result.ok({ version: result.value.version, replacements });
  }

  async glob(scopeKey: string, pattern: string, options?: { cwd?: string }): Promise<string[]> {
    const paths = await this.repo.listAllPaths(scopeKey);
    const cwd = options?.cwd;

    const matched = paths.filter((entryPath) => {
      if (cwd != null && cwd !== "/" && entryPath !== cwd && !entryPath.startsWith(`${cwd}/`)) {
        return false;
      }
      return matchGlob(pattern, entryPath);
    });

    matched.sort();
    return matched;
  }

  async grep(scopeKey: string, pattern: string, options?: VfsGrepOptions): Promise<Result<VfsGrepMatch[], AppError>> {
    const rows = await this.repo.scanContents(scopeKey, options?.pathPrefix);
    if (!rows.ok) return Result.err(rows.error);
    const filtered = options?.pathGlob != null ? rows.value.filter((row) => matchGlob(options.pathGlob!, row.path)) : rows.value;
    const matches = VfsGrep.grepContents(filtered, pattern, options);
    if (!matches.ok) return matches;
    return Result.ok(matches.value);
  }

  async delete(scopeKey: string, path: string, options?: { recursive?: boolean }): Promise<Result<void, AppError>> {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    if (normalized === "/") {
      return Result.err(new AppError("VFS_INVALID_PATH", {path, reason: "cannot delete root", detail: `Invalid path ${path}: cannot delete root`}));
    }
    await this.repo.delete(scopeKey, normalized, {
      recursive: options?.recursive === true,
    });
    return Result.ok(undefined);
  }

  async resetHeadToVersion(scopeKey: string, path: string, _version: number): Promise<Result<void, AppError>> {
    // 无 revision 层：补偿合同依赖 revision，禁止静默 no-op
    return Result.err(new AppError("VFS_OPERATION_UNSUPPORTED", { detail: `resetHeadToVersion is unsupported without revision history: ${scopeKey}:${path}` }));
  }

  /** nm-style: keep-public — InternalVfsService 端口方法；无 revision 层时与物理 delete 等价。 */
  hardDelete(scopeKey: string, path: string, options?: { recursive?: boolean }): Promise<Result<void, AppError>> {
    // 无墓碑可 append 时与物理 delete 一致
    return this.delete(scopeKey, path, options);
  }

  async renamePath(_scopeKey: string, fromLogical: string, _toLogical: string, _options?: { overwrite?: boolean }): Promise<Result<void, AppError>> {
    // rename 原语依赖事务 + repo + scopeKey，本服务只拿 repo 不在事务里跑；
    // 生产 wiring 走 RevisionAwareVfsService，不会命中此分支。
    return Result.err(new AppError("VFS_OPERATION_UNSUPPORTED", { detail: `renamePath is unsupported without revision history: ${fromLogical}` }));
  }

  async renamePrefix(_scopeKey: string, oldDirLogical: string, _newDirLogical: string): Promise<Result<void, AppError>> {
    return Result.err(new AppError("VFS_OPERATION_UNSUPPORTED", { detail: `renamePrefix is unsupported without revision history: ${oldDirLogical}` }));
  }
}
