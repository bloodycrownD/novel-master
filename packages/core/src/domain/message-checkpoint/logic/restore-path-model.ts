/**
 * restore 路径结果与 prefetch 契约（restore-path / revive-deleted-entry 共用）。
 *
 * @module domain/message-checkpoint/logic/restore-path-model
 */

import type { VfsRevisionPointerMeta } from "@/domain/vfs/repositories/vfs-revision.port.js";

/** restore 单路径结果（供 reconcile 统计短路次数）。 */
export type RestorePathOutcome =
  | "skipped_same_version"
  | "skipped_same_content_hash"
  | "restored"
  | "deleted";

/** reconcile 批量预取的 entryId / revision meta / live hash（内存比对，减 N 次 SQL）。 */
export type RestorePathPrefetch = {
  readonly entryIdByPath?: ReadonlyMap<string, number>;
  readonly revisionMetaByKey?: ReadonlyMap<string, VfsRevisionPointerMeta>;
  readonly liveHashByPath?: ReadonlyMap<string, string | null>;
  /**
   * checkpoint 记录的旧 entryId（path → entryId）：entry 行已被物理删除的
   * 路径靠它寻址 revision 并复活 entry（rollback-restore-deleted-entry）。
   */
  readonly checkpointEntryIdByPath?: ReadonlyMap<string, number>;
};
