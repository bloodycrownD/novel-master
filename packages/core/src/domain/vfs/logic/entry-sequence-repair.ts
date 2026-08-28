/**
 * vfs_entry AUTOINCREMENT 发号器修复（entry-sequence repair）。
 *
 * ## 病灶
 * 历史 migration / 重建路径可能让 `sqlite_sequence`（vfs_entry 的
 * AUTOINCREMENT 计数器）低于 `vfs_revision` 里仍存在的最大 entry_id：
 * revision 留下了指向已删除 entry 的悬空指针（孤儿 revision），而发号器
 * 只看 entry 表自身的 max。此后任何新建文件都会复用被孤儿占用的
 * entry_id，`vfs_revision` 的 `(entry_id, version)` 唯一键直接撞车——
 * 表现为「新建技能 / 写文件报 UNIQUE constraint failed:
 * vfs_revision.entry_id, vfs_revision.version」。
 *
 * ## 修法
 * 把 `sqlite_sequence` 的 seq 推到 `max(vfs_entry.entry_id,
 * vfs_revision.entry_id)`（不回退，只上调）。孤儿 revision 本身不删——
 * 可能仍被 checkpoint 指针引用，删除会破坏回滚；推号后永不复用，
 * 它们只占号段不再有害。
 *
 * 幂等：seq 已达标时 detect 返回 false，不产生写入。
 *
 * @module domain/vfs/logic/entry-sequence-repair
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type {
  IntegrityRepairDetection,
  IntegrityRepairOperation,
} from "@/service/integrity-repair.js";

export const VFS_ENTRY_SEQUENCE_REPAIR_NAME = "vfs-entry-sequence-repair";

async function readSequenceBoundaries(
  conn: TdbcConnection,
): Promise<{ seq: number; needed: number }> {
  // 全新库在首次自增插入前 sqlite_sequence 尚未物化（没有 vfs_entry 行，
  // 表本身随 AUTOINCREMENT 建表即存在）——查询返回空结果集而非抛错，
  // 下方 `?? 0` 兜底视为健康。查询异常则直接上抛：detect 抛错由 registry
  // （integrity-repair.ts）保守地按「需要修复」处理并挂到报告，这里
  // 绝不吞错伪装健康（吞错会让存量错位库静默漏修）。
  const entryMax = await conn.query<{ m: number | null }>(
    "SELECT MAX(entry_id) AS m FROM vfs_entry",
  );
  const revMax = await conn.query<{ m: number | null }>(
    "SELECT MAX(entry_id) AS m FROM vfs_revision",
  );
  const seqRow = await conn.query<{ seq: number | null }>(
    "SELECT seq FROM sqlite_sequence WHERE name = 'vfs_entry'",
  );
  const needed = Math.max(
    Number(entryMax[0]?.m ?? 0),
    Number(revMax[0]?.m ?? 0),
  );
  const seq = Number(seqRow[0]?.seq ?? 0);
  return { seq, needed };
}

/** 构造发号器修复操作（bootstrap 启动期无条件注册）。 */
export function createVfsEntrySequenceRepairOperation(
  conn: TdbcConnection,
): IntegrityRepairOperation {
  return {
    name: VFS_ENTRY_SEQUENCE_REPAIR_NAME,
    kind: "repair",
    async detect(): Promise<IntegrityRepairDetection> {
      const { seq, needed } = await readSequenceBoundaries(conn);
      return {
        needsRepair: seq < needed,
        details: `sqlite_sequence(vfs_entry)=${seq} < needed=${needed}（含孤儿 revision 占号）`,
      };
    },
    async repair(): Promise<void> {
      const { seq, needed } = await readSequenceBoundaries(conn);
      if (seq >= needed) {
        return;
      }
      // sqlite_sequence 可直接写入；无行（表从未自发递增过）时补一行
      const updated = await conn.execute(
        "UPDATE sqlite_sequence SET seq = ? WHERE name = 'vfs_entry'",
        [needed],
      );
      if (updated.changes === 0) {
        await conn.execute(
          "INSERT INTO sqlite_sequence (name, seq) VALUES ('vfs_entry', ?)",
          [needed],
        );
      }
    },
  };
}
