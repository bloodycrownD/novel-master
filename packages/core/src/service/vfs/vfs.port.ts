/**
 * VFS application service port and DTOs (public API contract).
 *
 * @module service/vfs/vfs.port
 */

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
 * Virtual file system application service.
 *
 * @remarks Implemented by {@link DefaultVfsService} inside core; consumers use
 * {@link createVfsService} and depend on this interface only.
 */
export interface VfsService {
  list(
    dir: string,
    options?: { recursive?: boolean; maxDepth?: number },
  ): Promise<string[]>;

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
