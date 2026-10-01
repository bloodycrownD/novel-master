/**
 * 共享 tail 截断事务逻辑（批量删与回滚共用）。
 *
 * @module domain/message-checkpoint/logic/truncate-tail-in-transaction
 */

import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import {
  SESSION_KKV_COMPOSER_STATUS_DOMAINS,
  SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import type { SessionKkvRepository } from "@/domain/session-kkv/repositories/session-kkv.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import {
  aggregateReadRefs,
  adjustReadRefCount,
} from "@/domain/vfs/logic/revision-ref-count.js";
import { sweepSessionRevisions } from "./revision-gc.js";

/** tail 截断事务参数。 */
export type TruncateTailParams = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly afterSeq: number;
  readonly sweepRevisions: boolean;
  /**
   * 是否把「全局孤儿清扫」推迟到事务提交后（rollback-large-jank Step 4）。
   *
   * 缺省即 `false`：事务内照常连同 scoped 打扫一起做全局孤儿 DELETE——本函数
   * 是回滚与批量删共用的共享函数，只有回滚链（事务正挡住 resolve 与 UI 链）
   * 才需要把它挪出去。置 `true` 时事务内只做 scoped 打扫，调用方**必须**自行
   * 在事务提交后 deferred 调度 `scheduleDeferredRevisionOrphanGc` 兜底，否则
   * 孤儿行永久残留。
   */
  readonly deferGlobalOrphanGc?: boolean;
};

/** {@link truncateTailInTransaction} 依赖。 */
export type TruncateTailDeps = {
  readonly messages: MessageRepository;
  readonly checkpoints: MessageCheckpointRepository;
  /** Composer 状态条真源：session kkv（tail 非空时按域清空）。 */
  readonly sessionKkv: SessionKkvRepository;
  readonly revisions: VfsRevisionRepository;
  readonly entries: VfsEntryRepository;
  /** 用于 migration 分支判断与 sweep。 */
  readonly conn: TdbcConnection;
};

/**
 * 在已有事务内截断 tail 消息并清理 checkpoint。
 *
 * 1. 子查询列出 seq > afterSeq 的 tail → read 引用批量 −1（**必须先于 sweep**，
 *    漏掉会让被引用 revision 被 GC——read 引用是 ref_count 的第三类持有者）
 *    → deleteCheckpointsForMessages（内含 −ref）
 * 2. messages.deleteAfterSeq(sessionId, afterSeq)
 * 3. 若 sweepRevisions → sweepSessionRevisions（scoped 打扫 + 全局孤儿兜底；
 *    调用方传 deferGlobalOrphanGc 时跳过全局孤儿那一半）
 * 4. 若 tail 非空 → 清 backfill 游标（seq 复用防线）+ 清空 Composer 无叉 chip 对应 kkv 域
 */
export async function truncateTailInTransaction(
  deps: TruncateTailDeps,
  params: TruncateTailParams
): Promise<void> {
  const { projectId, sessionId, afterSeq, sweepRevisions, deferGlobalOrphanGc } = params;

  // 拉带正文的 tail（seq > afterSeq ⟺ seq >= afterSeq + 1）：id 列表与 read
  // 引用收集共用一次查询。
  const tailMessages = await deps.messages.listBySessionFromSeq(
    sessionId,
    afterSeq + 1
  );
  const tailIds = tailMessages.map((m) => m.id);

  if (tailIds.length > 0) {
    // read 引用 −1：位置硬约束——必须在 sweepSessionRevisions 之前，否则被引用
    // 的 revision 会因 ref_count 未及时回落被误判为不可达而 GC（内容不可再生）。
    await adjustReadRefCount(
      deps.revisions,
      aggregateReadRefs(tailMessages.map((m) => m.content)),
      -1
    );
    await deps.checkpoints.deleteCheckpointsForMessages(sessionId, tailIds);
  }
  await deps.messages.deleteAfterSeq(sessionId, afterSeq);

  if (sweepRevisions) {
    // rollback-large-jank Step 4：默认保持原行为——scoped 打扫后接着做全局
    // 孤儿兜底（全表 DELETE）。只有显式 deferGlobalOrphanGc 的调用方（回滚
    // 链）才把它移出事务，改由该调用方在事务提交后 fire-and-forget 调度
    // scheduleDeferredRevisionOrphanGc 补做。
    await sweepSessionRevisions(
      deps.revisions,
      deps.entries,
      deps.checkpoints,
      projectId,
      sessionId,
      deps.conn,
      deferGlobalOrphanGc === true ? {includeGlobalOrphans: false} : undefined
    );
  }

  if (tailIds.length > 0) {
    // 发生删除即清 backfill 游标（seq 复用防线）：tail 删除后新消息会复用被删
    // 的 seq，残留游标按行数圈段会错位——清掉让下次判定回退全量自愈。
    await deps.sessionKkv.clearDomain(
      sessionId,
      SESSION_KKV_DOMAIN_BACKFILL_CURSOR
    );
    for (const domain of SESSION_KKV_COMPOSER_STATUS_DOMAINS) {
      await deps.sessionKkv.clearDomain(sessionId, domain);
    }
  }
}
