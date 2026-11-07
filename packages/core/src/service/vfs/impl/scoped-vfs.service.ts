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
  assertLogicalPathAllowed,
  resolveLogicalPath,
  scopeKey,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { InternalVfsService } from "../internal-vfs.port.js";
import { matchGlob } from "../glob-match.js";
import { throwLegacyVfs } from "./legacy-vfs-error.js";
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
    if (!resolvedDir.ok) throwLegacyVfs(resolvedDir.error);
    const logicalDir = resolvedDir.value;
    assertLogicalPathAllowed(this.scope, logicalDir);
    return this.inner.list(this.scopeKeyStr, logicalDir, options);
  }

  async mkdir(path: string): Promise<void> {
    const resolved = resolveLogicalPath(path);
    if (!resolved.ok) throwLegacyVfs(resolved.error);
    const logical = resolved.value;
    assertLogicalPathAllowed(this.scope, logical);
    return this.inner.mkdir(this.scopeKeyStr, logical);
  }

  async read(path: string): Promise<VfsReadResult> {
    const resolved = resolveLogicalPath(path);
    if (!resolved.ok) throwLegacyVfs(resolved.error);
    const logical = resolved.value;
    assertLogicalPathAllowed(this.scope, logical);
    return this.inner.read(this.scopeKeyStr, logical);
  }

  async findContentSize(path: string): Promise<VfsContentSize | null> {
    const resolved = resolveLogicalPath(path);
    if (!resolved.ok) throwLegacyVfs(resolved.error);
    const logical = resolved.value;
    assertLogicalPathAllowed(this.scope, logical);
    return this.inner.findContentSize(this.scopeKeyStr, logical);
  }

  async write(
    path: string,
    content: string
  ): Promise<{ version: number }> {
    const resolved = resolveLogicalPath(path);
    if (!resolved.ok) throwLegacyVfs(resolved.error);
    const logical = resolved.value;
    assertLogicalPathAllowed(this.scope, logical);
    return this.inner.write(this.scopeKeyStr, logical, content);
  }

  async replace(
    path: string,
    oldString: string,
    newString: string,
    options?: { replaceAll?: boolean }
  ): Promise<{ version: number; replacements: number }> {
    const resolved = resolveLogicalPath(path);
    if (!resolved.ok) throwLegacyVfs(resolved.error);
    const logical = resolved.value;
    assertLogicalPathAllowed(this.scope, logical);
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
      if (!resolved.ok) throwLegacyVfs(resolved.error);
      logicalCwd = resolved.value;
      assertLogicalPathAllowed(this.scope, logicalCwd);
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
      if (!resolved.ok) throwLegacyVfs(resolved.error);
      logicalPrefix = resolved.value;
      assertLogicalPathAllowed(this.scope, logicalPrefix);
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
    if (!resolved.ok) throwLegacyVfs(resolved.error);
    const logical = resolved.value;
    assertLogicalPathAllowed(this.scope, logical);
    return this.inner.delete(this.scopeKeyStr, logical, options);
  }

  async resetHeadToVersion(path: string, version: number): Promise<void> {
    const resolved = resolveLogicalPath(path);
    if (!resolved.ok) throwLegacyVfs(resolved.error);
    const logical = resolved.value;
    assertLogicalPathAllowed(this.scope, logical);
    return this.inner.resetHeadToVersion(this.scopeKeyStr, logical, version);
  }

  async hardDelete(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<void> {
    const resolved = resolveLogicalPath(path);
    if (!resolved.ok) throwLegacyVfs(resolved.error);
    const logical = resolved.value;
    assertLogicalPathAllowed(this.scope, logical);
    return this.inner.hardDelete(this.scopeKeyStr, logical, options);
  }

  async renamePath(
    from: string,
    to: string,
    options?: { overwrite?: boolean }
  ): Promise<void> {
    const resolvedFrom = resolveLogicalPath(from);
    if (!resolvedFrom.ok) throwLegacyVfs(resolvedFrom.error);
    const logicalFrom = resolvedFrom.value;
    const resolvedTo = resolveLogicalPath(to);
    if (!resolvedTo.ok) throwLegacyVfs(resolvedTo.error);
    const logicalTo = resolvedTo.value;
    assertLogicalPathAllowed(this.scope, logicalFrom);
    assertLogicalPathAllowed(this.scope, logicalTo);
    return this.inner.renamePath(
      this.scopeKeyStr,
      logicalFrom,
      logicalTo,
      options
    );
  }

  async renamePrefix(oldDir: string, newDir: string): Promise<void> {
    const resolvedOld = resolveLogicalPath(oldDir);
    if (!resolvedOld.ok) throwLegacyVfs(resolvedOld.error);
    const logicalOld = resolvedOld.value;
    const resolvedNew = resolveLogicalPath(newDir);
    if (!resolvedNew.ok) throwLegacyVfs(resolvedNew.error);
    const logicalNew = resolvedNew.value;
    assertLogicalPathAllowed(this.scope, logicalOld);
    assertLogicalPathAllowed(this.scope, logicalNew);
    return this.inner.renamePrefix(this.scopeKeyStr, logicalOld, logicalNew);
  }
}
