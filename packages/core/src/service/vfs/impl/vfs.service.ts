/**
 * Default VFS application service implementation.
 *
 * entry_id 化后实现 {@link InternalVfsService}（scopeKey + 纯逻辑路径），所有 repo
 * 调用带 scopeKey 透传。`resetHeadToVersion` 维持 unsupported 抛错（无 revision 层）；
 * `hardDelete` 维持走 `delete`；`renamePath` / `renamePrefix` 抛 unsupported（§D）。
 *
 * @module service/vfs/impl/vfs.service
 */

import { AppError } from "@/errors/app-error.js";
import { ensureParentDirectories } from "@/domain/vfs/logic/ensure-parent-dirs.js";
import { isStorageRootParent, parentDir } from "@/domain/vfs/logic/parent-dir.js";
import { assertValidVfsEntryName } from "@/domain/vfs/logic/validate-entry-name.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsContentSize } from "@/domain/vfs/model/vfs-content-size.js";
import { computeReplaceResult } from "@/domain/vfs/logic/compute-replace-result.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import { matchGlob } from "../glob-match.js";
import type { VfsGrepMatch, VfsGrepOptions, VfsListEntry, VfsReadResult } from "../internal-vfs.port.js";
import type { InternalVfsService } from "../internal-vfs.port.js";
import { grepContents } from "@/domain/vfs/logic/vfs-grep.js";

/**
 * VFS service delegating persistence to {@link VfsEntryRepository}.
 */
export class DefaultVfsService implements InternalVfsService {
  constructor(private readonly repo: VfsEntryRepository) {}

  /**
   * 解包 throw 边界（错误通道迁移三期门⑦）：normalizePath / 名称校验 `Result` → 领域异常通道转码点（本服务各方法同款）——非法路径按边界抛出，经 apps 至端点（handler / 屏幕 / CLI）catch 收口。
   */
  async list(scopeKey: string, dir: string, options?: { recursive?: boolean; maxDepth?: number }): Promise<VfsListEntry[]> {
    const resolved = normalizePath(dir);
    if (!resolved.ok) throw resolved.error;
    const normalized = resolved.value;
    const entries = await this.repo.list(scopeKey, normalized, options);
    if (normalized !== "/" && !isStorageRootParent(normalized)) {
      const entry = await this.repo.findByPath(scopeKey, normalized);
      // 虚拟 storage root 无目录行时视为空目录，与 mkdir 豁免一致
      if (entry == null && entries.length === 0) {
        throw new AppError("VFS_NOT_FOUND", {path: normalized, detail: `Path not found: ${normalized}`});
      }
    }
    return entries;
  }

  async mkdir(scopeKey: string, path: string): Promise<void> {
    const resolved = normalizePath(path);
    if (!resolved.ok) throw resolved.error;
    const normalized = resolved.value;
    if (normalized === "/") {
      throw new AppError("VFS_INVALID_PATH", {path, reason: "cannot mkdir root", detail: `Invalid path ${path}: cannot mkdir root`});
    }
    const nameCheck = assertValidVfsEntryName(normalized);
    if (!nameCheck.ok) throw nameCheck.error;

    const existing = await this.repo.findByPath(scopeKey, normalized);
    if (existing != null) {
      throw new AppError("VFS_ALREADY_EXISTS", {path: normalized, detail: `Path already exists: ${normalized}`});
    }

    const parent = parentDir(normalized);
    if (parent !== "/" && !isStorageRootParent(parent)) {
      const parentEntry = await this.repo.findByPath(scopeKey, parent);
      if (parentEntry == null) {
        throw new AppError("VFS_PARENT_NOT_FOUND", {path: parent, detail: `Parent not found: ${parent}`});
      }
      if (parentEntry.entryKind !== "directory") {
        throw new AppError("VFS_NOT_A_DIRECTORY", {path: parent, detail: `Not a directory: ${parent}`});
      }
    }

    await this.repo.insertDirectory(scopeKey, normalized);
  }

  async read(scopeKey: string, path: string): Promise<VfsReadResult> {
    const entry = await this.repo.findByPath(scopeKey, path);
    if (entry == null) {
      throw new AppError("VFS_NOT_FOUND", {path, detail: `Path not found: ${path}`});
    }
    if (entry.entryKind === "directory") {
      throw new AppError("VFS_IS_DIRECTORY", {path, detail: `Path is a directory: ${path}`});
    }
    return {
      path: entry.path,
      content: entry.content,
      version: entry.version,
      mtimeMs: entry.mtimeMs,
    };
  }

  async findContentSize(scopeKey: string, path: string): Promise<VfsContentSize | null> {
    return this.repo.findContentSizeByPath(scopeKey, path);
  }

  async write(scopeKey: string, path: string, content: string): Promise<{ version: number }> {
    const resolved = normalizePath(path);
    if (!resolved.ok) throw resolved.error;
    const normalized = resolved.value;
    const existing = await this.repo.findByPath(scopeKey, normalized);
    if (existing?.entryKind === "directory") {
      throw new AppError("VFS_IS_DIRECTORY", {path: normalized, detail: `Path is a directory: ${normalized}`});
    }
    if (existing == null) {
      // 只拦「创建」：存量条目（含 zip 导入的历史名）内容更新不重新审判名字
      const nameCheck = assertValidVfsEntryName(normalized);
      if (!nameCheck.ok) throw nameCheck.error;
      const parentCheck = await ensureParentDirectories(this.repo, scopeKey, normalized);
      if (!parentCheck.ok) throw parentCheck.error;
      return this.repo.insert(scopeKey, normalized, content);
    }
    return this.repo.update(scopeKey, normalized, content, existing.version + 1);
  }

  async replace(scopeKey: string, path: string, oldString: string, newString: string, options?: { replaceAll?: boolean }): Promise<{ version: number; replacements: number }> {
    const current = await this.read(scopeKey, path);
    const computed = computeReplaceResult(path, current.content, oldString, newString, options);
    if (!computed.ok) throw computed.error;
    const { nextContent, replacements } = computed.value;

    const result = await this.repo.update(scopeKey, path, nextContent, current.version + 1);
    return { version: result.version, replacements };
  }

  async glob(scopeKey: string, pattern: string, options?: { cwd?: string }): Promise<string[]> {
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

  async grep(scopeKey: string, pattern: string, options?: VfsGrepOptions): Promise<VfsGrepMatch[]> {
    const rows = await this.repo.scanContents(scopeKey, options?.pathPrefix);
    const filtered = options?.pathGlob != null ? rows.filter((row) => matchGlob(options.pathGlob!, row.path)) : rows;
    const matches = grepContents(filtered, pattern, options);
    if (!matches.ok) throw matches.error;
    return matches.value;
  }

  async delete(scopeKey: string, path: string, options?: { recursive?: boolean }): Promise<void> {
    const resolved = normalizePath(path);
    if (!resolved.ok) throw resolved.error;
    const normalized = resolved.value;
    if (normalized === "/") {
      throw new AppError("VFS_INVALID_PATH", {path, reason: "cannot delete root", detail: `Invalid path ${path}: cannot delete root`});
    }
    await this.repo.delete(scopeKey, normalized, {
      recursive: options?.recursive === true,
    });
  }

  async resetHeadToVersion(scopeKey: string, path: string, _version: number): Promise<void> {
    // 无 revision 层：补偿合同依赖 revision，禁止静默 no-op
    throw new AppError("VFS_OPERATION_UNSUPPORTED", { detail: `resetHeadToVersion is unsupported without revision history: ${scopeKey}:${path}` });
  }

  hardDelete(scopeKey: string, path: string, options?: { recursive?: boolean }): Promise<void> {
    // 无墓碑可 append 时与物理 delete 一致
    return this.delete(scopeKey, path, options);
  }

  renamePath(_scopeKey: string, fromLogical: string, _toLogical: string, _options?: { overwrite?: boolean }): Promise<void> {
    // rename 原语依赖事务 + repo + scopeKey，本服务只拿 repo 不在事务里跑；
    // 生产 wiring 走 RevisionAwareVfsService，不会命中此分支。
    throw new AppError("VFS_OPERATION_UNSUPPORTED", { detail: `renamePath is unsupported without revision history: ${fromLogical}` });
  }

  renamePrefix(_scopeKey: string, oldDirLogical: string, _newDirLogical: string): Promise<void> {
    throw new AppError("VFS_OPERATION_UNSUPPORTED", { detail: `renamePrefix is unsupported without revision history: ${oldDirLogical}` });
  }
}

function pathUnderDir(entryPath: string, dir: string): boolean {
  if (dir === "/") {
    return true;
  }
  return entryPath === dir || entryPath.startsWith(`${dir}/`);
}
