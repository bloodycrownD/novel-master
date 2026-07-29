/**
 * Append-only VFS revision row model (file content history).
 *
 * entry_id 化后 revision 改用 `(entryId, version)` 复合主键寻址，旧的 `path`
 * / `storageKind` 列退役。
 *
 * @module domain/vfs/model/vfs-revision
 */

/** Persisted revision lifecycle for a file path. */
export type VfsRevisionStatus = "active" | "deleted";

/**
 * Immutable content revision for a single file entry.
 */
export interface VfsRevision {
  /** 对应 vfs_entry.entry_id；rename / move 后仍指向同一文件。 */
  readonly entryId: number;
  readonly version: number;
  readonly content: string | null;
  readonly status: VfsRevisionStatus;
  readonly mtimeMs: number;
}
