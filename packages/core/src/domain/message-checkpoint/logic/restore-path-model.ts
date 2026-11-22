/**
 * restore 路径结果、deps / params 与 prefetch 契约（restore-path / revive-deleted-entry 共用）。
 *
 * @module domain/message-checkpoint/logic/restore-path-model
 */

import type { AppError } from "@/errors/app-error.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsContentStore } from "@/domain/vfs/content-store/vfs-content-store.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository, VfsRevisionPointerMeta } from "@/domain/vfs/repositories/vfs-revision.port.js";
import type { VfsRestorePort } from "@/domain/vfs/ports/vfs-restore.port.js";

/** restore 路径的领域失败：checkpoint 指针指向的 revision / 正文缺失，父目录被文件占用，以及下游路径工具透传的路径类码（四期返回值通道透传，联合放宽为全集）。 */
export type RestorePathError = AppError;

/** restore 单路径结果（供 reconcile 统计短路次数）。 */
export type RestorePathOutcome = "skipped_same_version" | "skipped_same_content_hash" | "restored" | "deleted";

/**
 * restore / revive 共用的行为端口与仓储依赖。
 *
 * `entryRepo` 可缺省：只在传入时启用 entryId 解析与 hash 短路，未传则退化为
 * 全量 find + write；revive 子集用 `Pick` 把它收成必填。
 */
export type RestorePathDeps = {
    /** 回滚作用域 VFS（墓碑删占用、重建父目录链）。 */
    readonly vfs: VfsRestorePort;
    readonly revisionRepo: VfsRevisionRepository;
    readonly entryRepo?: VfsEntryRepository;
    /** 可选 content store：put 幂等确保目标 blob 在位并回取 content_hash。 */
    readonly contentStore?: VfsContentStore;
};

/** restore 单路径的定位参数（deps 之外的全部入参）。 */
export type RestorePathParams = {
    readonly scope: VfsScope;
    readonly logicalPath: string;
    readonly version: number;
    /** live head 快照（path → version）：命中即跳过 restore。 */
    readonly liveHeadByPath?: ReadonlyMap<string, number>;
    /** reconcile 批量预取表；缺省逐条查库。 */
    readonly prefetch?: RestorePathPrefetch;
    /** checkpoint 记录的旧 entryId（无 prefetch 时的显式来源）。 */
    readonly checkpointEntryId?: number | null;
};

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
