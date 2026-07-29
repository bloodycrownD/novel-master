/**
 * vfs-revision-ref-count-v1：vfs_revision.ref_count 列 + 回填（checkpoint 指针 + live head）。
 *
 * @module bootstrap/schema-migrations/vfs-revision-ref-count-v1
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import {
  toPhysicalPath,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const VFS_REVISION_REF_COUNT_V1_ID = "vfs-revision-ref-count-v1";

async function columnNames(
  tx: TdbcConnection,
  table: string,
): Promise<Set<string>> {
  const rows = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${table}')`,
  );
  return new Set(rows.map((row) => String(row.name)));
}

/**
 * 回填 ref_count：按 checkpoint 行计数 + live file head 各 +1。
 *
 * 兼容守卫：entry_id 化后新 schema 的 `vfs_revision` 已无 `path` 列、
 * `message_checkpoint_file` 已无 `logical_path` 列，本函数的 SQL 会撞列不存在。
 * 新 schema 上 ref_count 由 entry-id migration 初始化 + 触发器维护，本回填完全退役，
 * 探测到新形态直接跳过。
 */
async function backfillRefCounts(tx: TdbcConnection): Promise<void> {
  const revisionCols = await columnNames(tx, "vfs_revision");
  if (revisionCols.size > 0 && !revisionCols.has("path")) {
    // entry_id 化后新形态：本回填退役。
    return;
  }
  const checkpointCols = await columnNames(tx, "message_checkpoint_file");
  if (checkpointCols.size > 0 && !checkpointCols.has("logical_path")) {
    // entry_id 化后新形态：本回填退役。
    return;
  }

  await tx.execute(`UPDATE vfs_revision SET ref_count = 0`);

  const counts = new Map<string, number>();

  const bump = (path: string, version: number, delta: number): void => {
    // 本 migration 属冻结代码（新库上 entry-id migration 已先跑，此回填退役）。
    // 不再 import revisionPairKey，本地字面拼接保持原 `path:version` 语义。
    const key = `${path}:${version}`;
    counts.set(key, (counts.get(key) ?? 0) + delta);
  };

  const checkpointRows = await tx.query<{
    session_id: string;
    project_id: string;
    logical_path: string;
    revision_version: number;
  }>(
    `SELECT mcf.session_id, cs.project_id, mcf.logical_path, mcf.revision_version
     FROM message_checkpoint_file mcf
     JOIN chat_session cs ON cs.id = mcf.session_id`,
  );
  for (const row of checkpointRows) {
    const physical = toPhysicalPath(
      {
        kind: "session",
        projectId: String(row.project_id),
        sessionId: String(row.session_id),
      },
      String(row.logical_path),
    );
    bump(physical, Number(row.revision_version), 1);
  }

  const liveHeads = await tx.query<{ path: string; head_version: number }>(
    `SELECT path, head_version FROM vfs_entry WHERE entry_kind = 'file'`,
  );
  for (const head of liveHeads) {
    bump(String(head.path), Number(head.head_version), 1);
  }

  for (const [key, count] of counts) {
    const sep = key.lastIndexOf(":");
    const path = key.slice(0, sep);
    const version = Number(key.slice(sep + 1));
    await tx.execute(
      `UPDATE vfs_revision SET ref_count = ?
       WHERE path = ? AND version = ?`,
      [count, path, version],
    );
  }
}

export const vfsRevisionRefCountV1Migration: SchemaMigration = {
  id: VFS_REVISION_REF_COUNT_V1_ID,
  async up(tx: TdbcConnection): Promise<void> {
    const names = await columnNames(tx, "vfs_revision");
    if (names.size === 0) {
      return;
    }
    if (!names.has("ref_count")) {
      await tx.execute(
        `ALTER TABLE vfs_revision ADD COLUMN ref_count INTEGER NOT NULL DEFAULT 0`,
      );
    }
    await backfillRefCounts(tx);
  },
};
