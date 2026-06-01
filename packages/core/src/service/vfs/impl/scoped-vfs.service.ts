/**
 * Scoped VFS service: maps logical paths per global/project/session domain.
 *
 * @module service/vfs/impl/scoped-vfs.service
 */

import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import {
  assertLogicalPathAllowed,
  resolveLogicalPath,
  toLogicalPath,
  toPhysicalPath,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsService } from "../vfs.port.js";
import type {
  VfsGrepMatch,
  VfsListEntry,
  VfsReadResult,
  WriteOptions,
} from "../vfs.port.js";

/**
 * Wraps an inner {@link VfsService} operating on physical paths.
 *
 * @remarks Callers use logical paths; physical `projects/…` layout is hidden.
 */
export class ScopedVfsService implements VfsService {
  constructor(
    private readonly inner: VfsService,
    private readonly scope: VfsScope,
  ) {}

  async list(
    dir: string,
    options?: { recursive?: boolean; maxDepth?: number },
  ): Promise<VfsListEntry[]> {
    const logicalDir = resolveLogicalPath(dir);
    assertLogicalPathAllowed(this.scope, logicalDir);
    const physicalDir = toPhysicalPath(this.scope, logicalDir);
    const entries = await this.inner.list(physicalDir, options);
    return entries.map((e) => ({
      path: toLogicalPath(this.scope, e.path),
      kind: e.kind,
    }));
  }

  async mkdir(path: string): Promise<void> {
    const logical = resolveLogicalPath(path);
    assertLogicalPathAllowed(this.scope, logical);
    const physical = toPhysicalPath(this.scope, logical);
    return this.inner.mkdir(physical);
  }

  async read(path: string): Promise<VfsReadResult> {
    const logical = resolveLogicalPath(path);
    assertLogicalPathAllowed(this.scope, logical);
    const physical = toPhysicalPath(this.scope, logical);
    const result = await this.inner.read(physical);
    return { ...result, path: toLogicalPath(this.scope, result.path) };
  }

  async write(
    path: string,
    content: string,
    options?: WriteOptions,
  ): Promise<{ version: number }> {
    const logical = resolveLogicalPath(path);
    assertLogicalPathAllowed(this.scope, logical);
    const physical = toPhysicalPath(this.scope, logical);
    return this.inner.write(physical, content, options);
  }

  async replace(
    path: string,
    oldString: string,
    newString: string,
    options?: { replaceAll?: boolean },
  ): Promise<{ version: number; replacements: number }> {
    const logical = resolveLogicalPath(path);
    assertLogicalPathAllowed(this.scope, logical);
    const physical = toPhysicalPath(this.scope, logical);
    return this.inner.replace(physical, oldString, newString, options);
  }

  async glob(
    pattern: string,
    options?: { cwd?: string },
  ): Promise<string[]> {
    const cwd = options?.cwd;
    let physicalCwd: string | undefined;
    if (cwd != null) {
      const logicalCwd = resolveLogicalPath(cwd);
      assertLogicalPathAllowed(this.scope, logicalCwd);
      physicalCwd = toPhysicalPath(this.scope, logicalCwd);
    }
    const paths = await this.inner.glob(pattern, { cwd: physicalCwd });
    return paths
      .map((p) => {
        try {
          return toLogicalPath(this.scope, p);
        } catch {
          return null;
        }
      })
      .filter((p): p is string => p != null);
  }

  async grep(
    pattern: string,
    options?: { pathPrefix?: string },
  ): Promise<VfsGrepMatch[]> {
    const prefix = options?.pathPrefix;
    let physicalPrefix: string | undefined;
    if (prefix != null) {
      const logicalPrefix = resolveLogicalPath(prefix);
      assertLogicalPathAllowed(this.scope, logicalPrefix);
      physicalPrefix = toPhysicalPath(this.scope, logicalPrefix);
    }
    const matches = await this.inner.grep(pattern, {
      pathPrefix: physicalPrefix,
    });
    return matches
      .map((m) => {
        try {
          return { ...m, path: toLogicalPath(this.scope, m.path) };
        } catch {
          return null;
        }
      })
      .filter((m): m is VfsGrepMatch => m != null);
  }

  async delete(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    const logical = resolveLogicalPath(path);
    assertLogicalPathAllowed(this.scope, logical);
    const physical = toPhysicalPath(this.scope, logical);
    return this.inner.delete(physical, options);
  }
}
