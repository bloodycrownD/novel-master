/**
 * Session FS 服务工厂。
 *
 * @module service/session-fs/create-session-fs-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { LogicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { RevisionRefCount } from "@/domain/vfs/logic/revision-ref-count.js";
import { DeferredBlobGc } from "@/domain/vfs/logic/deferred-blob-gc.js";
import { RevisionGc } from "@/domain/message-checkpoint/logic/revision-gc.js";
import { MessageCheckpointFactory } from "@/service/message-checkpoint/message-checkpoint-factory.js";
import type { RollbackProbe } from "@/service/message-checkpoint/message-rollback.port.js";
import { DefaultSessionFsService } from "./impl/session-fs.service.js";
import type { SessionFsService } from "./session-fs.port.js";

/**
 * {@link SessionFsServiceFactory.create} 可选装配项（均缺省 = 现状行为）。
 *
 * 本地定义而非复用 message-checkpoint 的 `MessageRollbackServiceOptions`：
 * session-fs 只透传回滚服务的两个装配项，不必把上一层的 options 类型暴露
 * 进自己的公开 API（避免跨层耦合）。
 */
interface SessionFsServiceOptions {
    /** 回滚链分段打点探针（mobile 在 __DEV__ 下注入；desktop/cli 不注入）。 */
    readonly probe?: RollbackProbe;
    /** plan 拉取列表行解析的片间让步（mobile 传 createQuantumYield(16)）。 */
    readonly yieldFn?: () => Promise<void>;
}

/** Session FS 服务工厂 + 会话 FS 数据清理集合。 */
export const SessionFsServiceFactory = {
    /** 为给定连接创建 {@link SessionFsService}（options 透传给回滚服务装配）。 */
    create(conn: TdbcConnection, options?: SessionFsServiceOptions): SessionFsService {
        return new DefaultSessionFsService({
            messageRollback: MessageCheckpointFactory.createRollback(conn, {
                probe: options?.probe,
                yieldFn: options?.yieldFn,
            }),
        });
    },

    /**
   * 删除会话 checkpoint / live ref / revision 打扫（会话删除 / 模板拉取时使用）。
   *
   * 顺序：−checkpoint ref → −live ref → 删 checkpoint 行 → revision 前缀打扫。
   * blob gc 由调用方在事务提交后调度 {@link DeferredBlobGc.run}。
   */
    async deleteData(conn: TdbcConnection, projectId: string, sessionId: string): Promise<void> {
        const checkpoints = new SqliteMessageCheckpointRepository(conn);
        const revisions = new SqliteVfsRevisionRepository(conn);
        const entries = new SqliteVfsEntryRepository(conn);
        const sessionScope = {
            kind: "session" as const,
            projectId,
            sessionId,
        };
        const sk = LogicalPath.scopeKey(sessionScope);

        await checkpoints.deleteCheckpointsForSession(sessionId);
        await RevisionRefCount.decrementLiveUnderScope({ revisionRepo: revisions, entryRepo: entries, scopeKey: sk, pathPrefix: "/" });
        await RevisionGc.sweepSession(revisions, projectId, sessionId);
    },
} as const;

/** 事务提交后调度全库 blob gc（项目/会话删除批量路径用）。 */
export { DeferredBlobGc };
