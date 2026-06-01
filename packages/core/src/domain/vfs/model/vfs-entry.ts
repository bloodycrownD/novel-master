/**
 * VFS entry model: persisted path row shape.
 *
 * @module domain/vfs/model/vfs-entry
 */

/** Storage kind for vfs_entry rows (inline only in v1). */
export type VfsStorageKind = "inline" | "external";

/** Persisted vfs_entry row kind. */
export type VfsEntryKind = "file" | "directory";

/**
 * A single VFS path entry as stored in SQLite.
 */
export interface VfsEntry {
  readonly path: string;
  readonly content: string;
  readonly version: number;
  readonly mtimeMs: number;
  readonly storageKind: VfsStorageKind;
  readonly externalUri: string | null;
  readonly entryKind: VfsEntryKind;
}
