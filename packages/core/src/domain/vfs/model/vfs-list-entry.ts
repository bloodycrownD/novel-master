/**
 * VFS list entry: path with file/directory kind.
 *
 * @module domain/vfs/model/vfs-list-entry
 */

/** Persisted entry kind for list results. */
export type VfsEntryKind = "file" | "directory";

/** A single path returned from {@link VfsService.list}. */
export interface VfsListEntry {
  readonly path: string;
  readonly kind: VfsEntryKind;
}
