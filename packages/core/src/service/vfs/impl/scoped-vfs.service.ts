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
import type {
  VfsGrepMatch,
  VfsGrepOptions,
  VfsListEntry,
  VfsReadResult,
  VfsService,
  WriteOptions,
} from "../vfs.port.js";

/**
 * Wraps an inner {@link InternalVfsService} operating on scopeKey + logical paths.
 *
 * @remarks Callers use logical paths; scopeKey is hidden behind this translation point.
 */
export class ScopedVfsService implements VfsService {
  constructor(
    private readonly inner: InternalVfsService,
    private readonly scope: VfsScope,
  ) {}

  private get scopeKeyStr(): string {
    return scopeKey(this.scope);
  }

  async list(
    dir: string,
    options?: { recursive?: boolean; maxDepth?: number },
  ): Promise<VfsListEntry[]> {
    const logicalDir = resolveLogicalPath(dir);
    assertLogicalPathAllowed(this.scope, logicalDir);
    return this.inner.list(this.scopeKeyStr, logicalDir, options);
  }

  async mkdir(path: string): Promise<void> {
    const logical = resolveLogicalPath(path);
    assertLogicalPathAllowed(this.scope, logical);
    return this.inner.mkdir(this.scopeKeyStr, logical);
  }

  async read(path: string): Promise<VfsReadResult> {
    const logical = resolveLogicalPath(path);
    assertLogicalPathAllowed(this.scope, logical);
    return this.inner.read(this.scopeKeyStr, logical);
  }

  async write(
    path: string,
    content: string,
    options?: WriteOptions,
  ): Promise<{ version: number }> {
    const logical = resolveLogicalPath(path);
    assertLogicalPathAllowed(this.scope, logical);
    return this.inner.write(this.scopeKeyStr, logical, content, options);
  }

  async replace(
    path: string,
    oldString: string,
    newString: string,
    options?: { replaceAll?: boolean },
  ): Promise<{ version: number; replacements: number }> {
    const logical = resolveLogicalPath(path);
    assertLogicalPathAllowed(this.scope, logical);
    return this.inner.replace(this.scopeKeyStr, logical, oldString, newString, options);
  }

  async glob(
    pattern: string,
    options?: { cwd?: string },
  ): Promise<string[]> {
    const cwd = options?.cwd;
    let logicalCwd: string | undefined;
    if (cwd != null) {
      logicalCwd = resolveLogicalPath(cwd);
      assertLogicalPathAllowed(this.scope, logicalCwd);
    }
    return this.inner.glob(this.scopeKeyStr, pattern, { cwd: logicalCwd });
  }

  async grep(
    pattern: string,
    options?: VfsGrepOptions,
  ): Promise<VfsGrepMatch[]> {
    const prefix = options?.pathPrefix;
    let logicalPrefix: string | undefined;
    if (prefix != null) {
      logicalPrefix = resolveLogicalPath(prefix);
      assertLogicalPathAllowed(this.scope, logicalPrefix);
    }
    const { pathGlob, ...innerOptions } = options ?? {};
    const matches = await this.inner.grep(this.scopeKeyStr, pattern, {
      ...innerOptions,
      pathPrefix: logicalPrefix,
    });
    return matches.filter((m) =>
      pathGlob != null ? matchGlob(pathGlob, m.path) : true,
    );
  }

  async delete(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    const logical = resolveLogicalPath(path);
    assertLogicalPathAllowed(this.scope, logical);
    return this.inner.delete(this.scopeKeyStr, logical, options);
  }

  async resetHeadToVersion(path: string, version: number): Promise<void> {
    const logical = resolveLogicalPath(path);
    assertLogicalPathAllowed(this.scope, logical);
    return this.inner.resetHeadToVersion(this.scopeKeyStr, logical, version);
  }

  async hardDelete(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    const logical = resolveLogicalPath(path);
    assertLogicalPathAllowed(this.scope, logical);
    return this.inner.hardDelete(this.scopeKeyStr, logical, options);
  }
}
