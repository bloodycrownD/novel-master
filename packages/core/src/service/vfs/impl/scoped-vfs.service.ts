/**
 * Scoped VFS service: maps logical paths per global/project/session domain.
 *
 * 对外继续实现 {@link VfsService}（apps 层契约不变）；对内把 `scope.scopeKey` 透传给
 * {@link InternalVfsService} 的每一条点查询。entry_id 化后 `vfs_entry.path` 直接存纯
 * 逻辑路径，inner 返回的 path 本身就是 logical，`list/glob/grep` 不再需要反向转换。
 *
 * @module service/vfs/impl/scoped-vfs.service
 */

import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import {
  resolveLogicalPath,
  scopeKey,
  validateLogicalPath,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { InternalVfsService } from "../internal-vfs.port.js";
import { matchGlob } from "../glob-match.js";
import type {
  VfsGrepMatch,
  VfsGrepOptions,
  VfsListEntry,
  VfsReadResult,
  VfsService,
} from "../vfs.port.js";
import type { VfsContentSize } from "@/domain/vfs/model/vfs-content-size.js";

/**
 * Wraps an inner {@link InternalVfsService} operating on scopeKey + logical paths.
 *
 * @remarks Callers use logical paths; scopeKey is hidden behind this translation point.
 */
export class ScopedVfsService implements VfsService {
  constructor(
    private readonly inner: InternalVfsService,
    private readonly scope: VfsScope
  ) {}

  private get scopeKeyStr(): string {
    return scopeKey(this.scope);
  }

  async list(
    dir: string,
    options?: { recursive?: boolean; maxDepth?: number }
  ): Promise<VfsListEntry[]> {
    const resolvedDir = resolveLogicalPath(dir);
    if (!resolvedDir.ok) throw resolvedDir.error;
    const logicalDir = resolvedDir.value;
    const allowedDir = validateLogicalPath(this.scope, logicalDir);
    if (!allowedDir.ok) throw allowedDir.error;
    return this.inner.list(this.scopeKeyStr, logicalDir, options);
  }

  /**
   * 解包 throw 边界（错误通道迁移三期门⑦）：resolveLogicalPath / scope 校验 `Result` → 领域异常通道转码点（本服务各方法同款）——非法路径按边界抛出，由调用链端点 catch 收口。
   */
  async mkdir(path: string): Promise<void> {
    const resolved = resolveLogicalPath(path);
    if (!resolved.ok) throw resolved.error;
    const logical = resolved.value;
    const allowed = validateLogicalPath(this.scope, logical);
    if (!allowed.ok) throw allowed.error;
    return this.inner.mkdir(this.scopeKeyStr, logical);
  }

  async read(path: string): Promise<VfsReadResult> {
    const resolved = resolveLogicalPath(path);
    if (!resolved.ok) throw resolved.error;
    const logical = resolved.value;
    const allowed = validateLogicalPath(this.scope, logical);
    if (!allowed.ok) throw allowed.error;
    return this.inner.read(this.scopeKeyStr, logical);
  }

  async findContentSize(path: string): Promise<VfsContentSize | null> {
    const resolved = resolveLogicalPath(path);
    if (!resolved.ok) throw resolved.error;
    const logical = resolved.value;
    const allowed = validateLogicalPath(this.scope, logical);
    if (!allowed.ok) throw allowed.error;
    return this.inner.findContentSize(this.scopeKeyStr, logical);
  }

  async write(
    path: string,
    content: string
  ): Promise<{ version: number }> {
    const resolved = resolveLogicalPath(path);
    if (!resolved.ok) throw resolved.error;
    const logical = resolved.value;
    const allowed = validateLogicalPath(this.scope, logical);
    if (!allowed.ok) throw allowed.error;
    return this.inner.write(this.scopeKeyStr, logical, content);
  }

  async replace(
    path: string,
    oldString: string,
    newString: string,
    options?: { replaceAll?: boolean }
  ): Promise<{ version: number; replacements: number }> {
    const resolved = resolveLogicalPath(path);
    if (!resolved.ok) throw resolved.error;
    const logical = resolved.value;
    const allowed = validateLogicalPath(this.scope, logical);
    if (!allowed.ok) throw allowed.error;
    return this.inner.replace(
      this.scopeKeyStr,
      logical,
      oldString,
      newString,
      options
    );
  }

  async glob(pattern: string, options?: { cwd?: string }): Promise<string[]> {
    const cwd = options?.cwd;
    let logicalCwd: string | undefined;
    if (cwd != null) {
      const resolved = resolveLogicalPath(cwd);
      if (!resolved.ok) throw resolved.error;
      logicalCwd = resolved.value;
      const allowedCwd = validateLogicalPath(this.scope, logicalCwd);
      if (!allowedCwd.ok) throw allowedCwd.error;
    }
    return this.inner.glob(this.scopeKeyStr, pattern, { cwd: logicalCwd });
  }

  async grep(
    pattern: string,
    options?: VfsGrepOptions
  ): Promise<VfsGrepMatch[]> {
    const prefix = options?.pathPrefix;
    let logicalPrefix: string | undefined;
    if (prefix != null) {
      const resolved = resolveLogicalPath(prefix);
      if (!resolved.ok) throw resolved.error;
      logicalPrefix = resolved.value;
      const allowedPrefix = validateLogicalPath(this.scope, logicalPrefix);
      if (!allowedPrefix.ok) throw allowedPrefix.error;
    }
    const { pathGlob, ...innerOptions } = options ?? {};
    const matches = await this.inner.grep(this.scopeKeyStr, pattern, {
      ...innerOptions,
      pathPrefix: logicalPrefix,
    });
    return matches.filter((m) =>
      pathGlob != null ? matchGlob(pathGlob, m.path) : true
    );
  }

  async delete(path: string, options?: { recursive?: boolean }): Promise<void> {
    const resolved = resolveLogicalPath(path);
    if (!resolved.ok) throw resolved.error;
    const logical = resolved.value;
    const allowed = validateLogicalPath(this.scope, logical);
    if (!allowed.ok) throw allowed.error;
    return this.inner.delete(this.scopeKeyStr, logical, options);
  }

  async resetHeadToVersion(path: string, version: number): Promise<void> {
    const resolved = resolveLogicalPath(path);
    if (!resolved.ok) throw resolved.error;
    const logical = resolved.value;
    const allowed = validateLogicalPath(this.scope, logical);
    if (!allowed.ok) throw allowed.error;
    return this.inner.resetHeadToVersion(this.scopeKeyStr, logical, version);
  }

  async hardDelete(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<void> {
    const resolved = resolveLogicalPath(path);
    if (!resolved.ok) throw resolved.error;
    const logical = resolved.value;
    const allowed = validateLogicalPath(this.scope, logical);
    if (!allowed.ok) throw allowed.error;
    return this.inner.hardDelete(this.scopeKeyStr, logical, options);
  }

  async renamePath(
    from: string,
    to: string,
    options?: { overwrite?: boolean }
  ): Promise<void> {
    const resolvedFrom = resolveLogicalPath(from);
    if (!resolvedFrom.ok) throw resolvedFrom.error;
    const logicalFrom = resolvedFrom.value;
    const resolvedTo = resolveLogicalPath(to);
    if (!resolvedTo.ok) throw resolvedTo.error;
    const logicalTo = resolvedTo.value;
    const allowedFrom = validateLogicalPath(this.scope, logicalFrom);
    if (!allowedFrom.ok) throw allowedFrom.error;
    const allowedTo = validateLogicalPath(this.scope, logicalTo);
    if (!allowedTo.ok) throw allowedTo.error;
    return this.inner.renamePath(
      this.scopeKeyStr,
      logicalFrom,
      logicalTo,
      options
    );
  }

  async renamePrefix(oldDir: string, newDir: string): Promise<void> {
    const resolvedOld = resolveLogicalPath(oldDir);
    if (!resolvedOld.ok) throw resolvedOld.error;
    const logicalOld = resolvedOld.value;
    const resolvedNew = resolveLogicalPath(newDir);
    if (!resolvedNew.ok) throw resolvedNew.error;
    const logicalNew = resolvedNew.value;
    const allowedOld = validateLogicalPath(this.scope, logicalOld);
    if (!allowedOld.ok) throw allowedOld.error;
    const allowedNew = validateLogicalPath(this.scope, logicalNew);
    if (!allowedNew.ok) throw allowedNew.error;
    return this.inner.renamePrefix(this.scopeKeyStr, logicalOld, logicalNew);
  }
}
