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
  /**
   * 当前 head 版本（对应 DB 的 head_version 列）。
   *
   * @remarks 仅在 list 的 SQL 已 SELECT head_version 时填充；
   * 调用方需要 version 时应显式判断 undefined，不可假定一定存在。
   */
  readonly version?: number;
}
