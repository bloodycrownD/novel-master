/**
 * VFS capability port and DTOs (domain contract for tools, CLI, and service impl).
 *
 * @module domain/vfs/ports/vfs-service.port
 *
 * @remarks
 * Implemented by {@link DefaultVfsService} / {@link ScopedVfsService} in service layer.
 * Builtin tools and external consumers depend on this port only — not on `service/vfs`.
 */

import type { VfsEntryKind } from "../model/vfs-entry.js";
import type { VfsListEntry } from "../model/vfs-list-entry.js";

export type { VfsEntryKind, VfsListEntry };

/** Result of reading a single path. */
export interface VfsReadResult {
  readonly path: string;
  readonly content: string;
  readonly version: number;
  readonly mtimeMs: number;
}

/** Options for write operations. */
export interface WriteOptions {
  readonly expectedVersion?: number;
  readonly versionCheck?: boolean;
}

/** A single grep match with line/column position. */
export interface VfsGrepMatch {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly excerpt: string;
}

/**
 * Virtual file system capability (read/write/list/glob/grep/delete/mkdir).
 *
 * @remarks
 * Scoping (global / project / session paths) is applied by scoped service wrappers;
 * callers inject the appropriate instance (e.g. session-scoped for agent tools).
 */
export interface VfsService {
  list(
    dir: string,
    options?: { recursive?: boolean; maxDepth?: number },
  ): Promise<VfsListEntry[]>;

  mkdir(path: string): Promise<void>;

  read(path: string): Promise<VfsReadResult>;

  write(
    path: string,
    content: string,
    options?: WriteOptions,
  ): Promise<{ version: number }>;

  replace(
    path: string,
    oldString: string,
    newString: string,
    options?: { replaceAll?: boolean },
  ): Promise<{ version: number; replacements: number }>;

  glob(pattern: string, options?: { cwd?: string }): Promise<string[]>;

  grep(
    pattern: string,
    options?: { pathPrefix?: string },
  ): Promise<VfsGrepMatch[]>;

  delete(path: string, options?: { recursive?: boolean }): Promise<void>;
}
