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
   * 展示名（可选）：物理树合成目录行用它替代路径末段 UUID 显示（项目名/会话名）。
   *
   * @remarks 仅用于展示层；导航、路径解析与排序键之外的一切逻辑均以 path 为准，
   * 不得把 label 当作路径的一部分消费。非物理树场景不填充。
   */
  readonly label?: string;
  /**
   * 当前 head 版本（对应 DB 的 head_version 列）。
   *
   * @remarks 仅在 list 的 SQL 已 SELECT head_version 时填充；
   * 调用方需要 version 时应显式判断 undefined，不可假定一定存在。
   */
  readonly version?: number;
}
