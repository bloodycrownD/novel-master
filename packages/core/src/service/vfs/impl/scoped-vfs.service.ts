/**
 * Scoped VFS service: maps logical paths per global/project/session domain.
 *
 * @module service/vfs/impl/scoped-vfs.service
 */

import type { VfsScope } from "@/domain/vfs/vfs-path-mapper.js";
import {
  assertLogicalPathAllowed,
  toLogicalPath,
  toPhysicalPath,
} from "@/domain/vfs/vfs-path-mapper.js";
import type { VfsService } from "../vfs.port.js";
import type {
  VfsGrepMatch,
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
  ): Promise<string[]> {
    assertLogicalPathAllowed(this.scope, dir);
    const physicalDir = toPhysicalPath(this.scope, dir);
    const paths = await this.inner.list(physicalDir, options);
    return paths.map((p) => toLogicalPath(this.scope, p));
  }

  async read(path: string): Promise<VfsReadResult> {
    assertLogicalPathAllowed(this.scope, path);
    const physical = toPhysicalPath(this.scope, path);
    const result = await this.inner.read(physical);
    return { ...result, path: toLogicalPath(this.scope, result.path) };
  }

  async write(
    path: string,
    content: string,
    options?: WriteOptions,
  ): Promise<{ version: number }> {
    assertLogicalPathAllowed(this.scope, path);
    const physical = toPhysicalPath(this.scope, path);
    return this.inner.write(physical, content, options);
  }

  async replace(
    path: string,
    oldString: string,
    newString: string,
    options?: { replaceAll?: boolean },
  ): Promise<{ version: number; replacements: number }> {
    assertLogicalPathAllowed(this.scope, path);
    const physical = toPhysicalPath(this.scope, path);
    return this.inner.replace(physical, oldString, newString, options);
  }

  async glob(
    pattern: string,
    options?: { cwd?: string },
  ): Promise<string[]> {
    const cwd = options?.cwd;
    if (cwd != null) {
      assertLogicalPathAllowed(this.scope, cwd);
    }
    const physicalCwd =
      cwd != null ? toPhysicalPath(this.scope, cwd) : undefined;
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
    if (prefix != null) {
      assertLogicalPathAllowed(this.scope, prefix);
    }
    const physicalPrefix =
      prefix != null ? toPhysicalPath(this.scope, prefix) : undefined;
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
    assertLogicalPathAllowed(this.scope, path);
    const physical = toPhysicalPath(this.scope, path);
    return this.inner.delete(physical, options);
  }
}
