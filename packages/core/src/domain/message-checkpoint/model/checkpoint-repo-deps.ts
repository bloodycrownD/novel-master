/**
 * checkpoint / VFS 修复族共享的仓储依赖底座。
 *
 * 命名口径统一为 `xxxRepo` 后缀（truncate / revive / restore / backfill 同款）；
 * 各入口按需扩展出自己的 deps 类型，不合成单一胖对象。
 *
 * @module domain/message-checkpoint/model/checkpoint-repo-deps
 */

import type { MessageCheckpointRepository } from "../repositories/message-checkpoint.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";

/** 共享底座：entry / revision / checkpoint 三个仓储。 */
export type CheckpointRepoDeps = {
    readonly entryRepo: VfsEntryRepository;
    readonly revisionRepo: VfsRevisionRepository;
    readonly checkpointRepo: MessageCheckpointRepository;
};
