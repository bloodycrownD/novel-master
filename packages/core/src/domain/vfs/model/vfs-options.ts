/**
 * VFS repository and list option types.
 *
 * @module domain/vfs/model/vfs-options
 */

/** Options for listing paths under a directory. */
export interface VfsListOptions {
  readonly recursive?: boolean;
  readonly maxDepth?: number;
}

/** Options for repository write/update. */
export interface VfsWriteRepoOptions {
  readonly expectedVersion?: number;
  readonly versionCheck: boolean;
}

/** Options for repository delete. */
export interface VfsDeleteOptions {
  readonly recursive: boolean;
}
