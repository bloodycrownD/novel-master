/**
 * VFS entry model: persisted path row shape.
 *
 * entry_id 化后以不可变的 `entryId` 作身份键，`scopeKey` + `path` 共同定位；
 * 旧的 `storageKind`（恒 inline）/ `externalUri`（恒 NULL）已退役。`version` 字段
 * 语义上就是 head 版本（对应 DB 的 `head_version` 列）。
 *
 * @module domain/vfs/model/vfs-entry
 */

/** Persisted vfs_entry row kind. */
export type VfsEntryKind = "file" | "directory";

/**
 * A single VFS entry as stored in SQLite.
 */
export interface VfsEntry {
  /** 不可变身份键；rename / move 后保持不变。 */
  readonly entryId: number;
  /** scope 归属键，如 `session:{pid}:{sid}` / `project:{pid}` / `global`。 */
  readonly scopeKey: string;
  /** scope 内的纯逻辑路径。 */
  readonly path: string;
  readonly content: string;
  /** 当前 head 版本（对应 DB 的 `head_version` 列）。 */
  readonly version: number;
  readonly mtimeMs: number;
  readonly entryKind: VfsEntryKind;
}
