/**
 * Default {@link MessageCheckpointService} implementation.
 *
 * @module service/message-checkpoint/impl/message-checkpoint.service
 */

import {
  decideBackfillShortCircuit,
  scanBackfillGap,
  writeBackfillGap,
} from "@/domain/message-checkpoint/logic/backfill-baseline-checkpoints.js";
import { listSessionFileHeads } from "@/domain/message-checkpoint/logic/list-session-files.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteSessionKkvRepository } from "@/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.js";
import {
  BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY,
  SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { MessageCheckpointService } from "../message-checkpoint.port.js";

/** Dependencies for {@link DefaultMessageCheckpointService}. */
export interface MessageCheckpointServiceDeps {
  readonly conn: TdbcConnection;
  readonly entries: VfsEntryRepository;
}

/**
 * Scans session files and writes a checkpoint tree (files only, no empty dirs).
 */
export class DefaultMessageCheckpointService
  implements MessageCheckpointService
{
  constructor(private readonly deps: MessageCheckpointServiceDeps) {}

  /**
   * @remarks listSessionFileHeads 移入事务内执行，持锁扫描避免并发 capture 捕获陈旧 head。
   */
  async capture(
    sessionId: string,
    projectId: string,
    messageId: string
  ): Promise<void> {
    await this.deps.conn.transaction(async (tx) => {
      // listSessionFileHeads 在事务内调：用绑定 tx 的 entry repo 持锁扫描，
      // 避免并发 capture 读到未提交的 head（V8）。
      const txEntries = new SqliteVfsEntryRepository(tx);
      const files = await listSessionFileHeads(txEntries, projectId, sessionId);
      if (files.length === 0) {
        return;
      }

      const checkpoints = new SqliteMessageCheckpointRepository(tx);
      await checkpoints.insertCheckpoint({
        sessionId,
        messageId,
        createdAtMs: Date.now(),
        files: files.map((f) => ({
          entryId: f.entryId,
          revisionVersion: f.headVersion,
          path: f.logicalPath,
        })),
      });
    });
  }

  /**
   * @remarks 拆成三段（CS-05/CS-05b）：**段 0 + 段 1 在事务外、只读**
   * （短路判定 / 定位空窗 / 取指针快照），**段 2 是只装补写语句的短事务**
   * （`insertCheckpoint` + 游标 `set`）。旧形态把判定 + 全量扫描 + 补写塞在
   * 同一条写事务里，而这条路径**每轮发送都跑**——大会话上正是「用户消息落库
   * 要等几秒」的第一站。
   *
   * 段 1 的 `listSessionFileHeads` 是 stale-by-one 的**有意**取舍：backfill 要
   * 的是**基线**指针快照（checkpoint 的定义就是某一时刻的快照，晚一版合法），
   * 不是最新态 —— 需要最新 head 的是 `capture`，它的扫描仍留在事务内。
   * 段 1/段 2 之间的写由**连续前缀复核**闭合（见 `writeBackfillGap`），
   * 而段 2 一旦开始到提交之前不存在并发写（本仓单 `TdbcConnection` 串行化写）。
   * ⚠️ 该结论**仅对本仓单连接形态成立**，别的连接形态不要照抄。
   *
   * 入口的两段式「无空窗」短路判定（游标计数比对 + 新增段有界覆盖比对）
   * 判定不确定时保守回退全量扫描。
   *
   * r3-run-4：`signal` 供前奏期的停止意图在扫描/补写前兑现弃权。**中途退出
   * 保留已写部分**（事务正常提交）——安全，因为 backfill 幂等：已写的
   * checkpoint 行不会被覆盖、下一轮发送接着补齐剩余空窗；且中断路径下
   * `confirmedNoGap` 恒为 false → 游标**不写** → 下轮判定必然回退全量，
   * 绝不会把「只补了一半」误认成「已确认无空窗」。不传 signal 时与旧版等价。
   */
  async backfillMissingBaselines(
    sessionId: string,
    projectId: string,
    signal?: AbortSignal
  ): Promise<void> {
    // 段 0（事务外，只读）：两段式短路判定。
    const decision = await decideBackfillShortCircuit({
      sessionKkv: new SqliteSessionKkvRepository(this.deps.conn),
      messageRepo: new SqliteMessageRepository(this.deps.conn),
      checkpointRepo: new SqliteMessageCheckpointRepository(this.deps.conn),
      sessionId,
    });

    if (decision.kind === "short-circuit") {
      // 弃权点（r3-run-4）：短路判定本身就是几次单行读、窗口极短，但把它放在
      // 游标写入**之前**检查——短路写入只前移游标、不补数据，中途退出无害，
      // 而「停了却仍写游标」纯属没必要的副作用。
      if (signal?.aborted === true) {
        return;
      }
      // 游标只在值前移时写（count == 游标的短路不产生写入）。
      if (decision.newCursor !== decision.previousCursor) {
        const kkv = new SqliteSessionKkvRepository(this.deps.conn);
        await kkv.set(
          sessionId,
          SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
          BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY,
          String(decision.newCursor)
        );
      }
      return;
    }

    // 段 1（事务外，只读）：定位空窗 + 取 live head 指针快照。
    const scan = await scanBackfillGap({
      entryRepo: new SqliteVfsEntryRepository(this.deps.conn),
      messageRepo: new SqliteMessageRepository(this.deps.conn),
      checkpointRepo: new SqliteMessageCheckpointRepository(this.deps.conn),
      projectId,
      sessionId,
      signal,
    });
    if (scan.gapMessageIds.length === 0 && !scan.confirmedNoGap) {
      // 无 live 文件：无法建点也无法验证，不算确认——游标留空让下次继续走全量。
      return;
    }

    // 段 2（短事务，只写）：连续前缀复核 + 逐条补写；确认无空窗才写游标。
    await this.deps.conn.transaction(async (tx) => {
      // 事务回调里**所有** repo 都必须用回调传入的 tx 构造；用外层 conn 会撞
      // 驱动层 AsyncMutex 不可重入——那是死锁不是报错。
      const result = await writeBackfillGap({
        checkpointRepo: new SqliteMessageCheckpointRepository(tx),
        sessionId,
        scan,
        signal,
      });
      if (result.confirmedNoGap) {
        const kkv = new SqliteSessionKkvRepository(tx);
        await kkv.set(
          sessionId,
          SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
          BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY,
          String(decision.count)
        );
      }
    });
  }

  /**
   * {@link release} 的默认实现：直接用连接构造 repo 删行。
   *
   * 单条 delete 不值得再裹一层事务——`deleteCheckpointsForMessages` 自己按
   * ≤900 变量分块发确定 SQL，没有中间态。幂等：消息没有 checkpoint 时 repo 层
   * 也不会抛错。
   */
  async release(sessionId: string, messageId: string): Promise<void> {
    const checkpoints = new SqliteMessageCheckpointRepository(this.deps.conn);
    await checkpoints.deleteCheckpointsForMessages(sessionId, [messageId]);
  }
}
