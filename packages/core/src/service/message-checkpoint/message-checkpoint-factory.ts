/**
 * Message checkpoint / rollback service factory.
 *
 * @module service/message-checkpoint/message-checkpoint-factory
 */

import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import type { TruncateTailDeps } from "@/domain/message-checkpoint/logic/truncate-tail-in-transaction.js";
import type { CheckpointRepoDeps } from "@/domain/message-checkpoint/model/checkpoint-repo-deps.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteSessionKkvRepository } from "@/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { DefaultMessageCheckpointService } from "./impl/message-checkpoint.service.js";
import { DefaultMessageRollbackService } from "./impl/message-rollback.service.js";
import type { MessageCheckpointService } from "./message-checkpoint.port.js";
import type { MessageRollbackService, RollbackProbe } from "./message-rollback.port.js";

/** {@link MessageCheckpointFactory.createRollback} 可选装配项（均缺省 = 现状行为）。 */
export interface MessageRollbackServiceOptions {
    /**
   * 回滚链分段打点探针（rollback-large-jank Step 1）：mobile 在 __DEV__
   * 下注入；desktop/cli 不注入（恒 no-op）。
   */
    readonly probe?: RollbackProbe;
    /**
   * plan 拉取列表行解析的片间让步（rollback-large-jank Step 2）：mobile
   * 传 createQuantumYield(16)；缺省不传 → 直通同步 map（现状行为）。
   */
    readonly yieldFn?: () => Promise<void>;
}

export const MessageCheckpointFactory = {
    /**
   * Creates a {@link MessageCheckpointService} for the given connection.
   *
   * nm-style: keep-public — 边界隔离壳：`public/message-checkpoint.ts` 只导出端口与本工厂，
   * 不导出实现类 `DefaultMessageCheckpointService`；删掉这个方法会把实现类暴露到 public 面。
   * 与 `createRollback` 不同，它没有装配逻辑（无 repo 构造、无 deps 展开）。
   */
    create(conn: TdbcConnection): MessageCheckpointService {
        return new DefaultMessageCheckpointService({ conn });
    },

    /** Creates a {@link MessageRollbackService} for the given connection. */
    createRollback(conn: TdbcConnection, options?: MessageRollbackServiceOptions): MessageRollbackService {
        return new DefaultMessageRollbackService({
            conn,
            messageRepo: new SqliteMessageRepository(conn, options?.yieldFn),
            ...MessageCheckpointFactory.createRepoDeps(conn),
            probe: options?.probe,
        });
    },

    /** 构造 checkpoint / VFS 修复族共享的三个仓储依赖（conn 或事务 tx 均可）。 */
    createRepoDeps(conn: TdbcConnection): CheckpointRepoDeps {
        return {
            entryRepo: new SqliteVfsEntryRepository(conn),
            revisionRepo: new SqliteVfsRevisionRepository(conn),
            checkpointRepo: new SqliteMessageCheckpointRepository(conn),
        };
    },

    /**
   * 从事务连接构造 {@link TruncateTailDeps}。
   *
   * 只带截断链消费的 4 项（history 期的 entryRepo / conn 已随弃参删除）；
   * checkpoint / revision 两项复用 {@link MessageCheckpointFactory.createRepoDeps}。
   */
    createTruncateTailDeps(tx: TdbcConnection): TruncateTailDeps {
        const { checkpointRepo, revisionRepo } = MessageCheckpointFactory.createRepoDeps(tx);
        return {
            messageRepo: new SqliteMessageRepository(tx),
            checkpointRepo,
            revisionRepo,
            sessionKkv: new SqliteSessionKkvRepository(tx),
        };
    },
} as const;
