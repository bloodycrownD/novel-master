/**
 * add-smart-sort-capture-kind-v1：smart_sort_rule 加 capture_kind 列
 * （fix-capture-kind / D13：捕获数字三档 smart | fixed_min | fixed_max，
 * 默认 smart——存量四条内置与用户规则行为零变化）。
 *
 * ADD COLUMN 带 CHECK + NOT NULL DEFAULT 是 SQLite 合法形态（默认值非空，
 * 存量行自动落 'smart'，无需回填）。幂等探测照 rename 迁移模式：PRAGMA
 * table_info 无 capture_kind 才 ALTER；新库（canonical DDL 直接建出该列）
 * 与已迁移库都早退。
 *
 * 本迁移走 pending migration 通道（快/慢路径都会跑），SCHEMA_BOOT_VERSION
 * 不 bump（pending migration 不受 bootVersion 快路径短路，v9/v10 教训
 * 不适用）。
 *
 * @module bootstrap/schema-migrations/add-smart-sort-capture-kind-v1
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SMART_SORT_RULE_TABLE } from "../smart-sort-rule/smart-sort-rule-schema.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const ADD_SMART_SORT_CAPTURE_KIND_V1_ID =
  "add-smart-sort-capture-kind-v1";

/** 供测试直接调用的迁移主体。 */
export async function addSmartSortCaptureKindV1Up(
  tx: TdbcConnection
): Promise<void> {
  const cols = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${SMART_SORT_RULE_TABLE}')`
  );
  const hasColumn = cols.some((r) => String(r.name) === "capture_kind");
  // 已有 capture_kind（新库 canonical DDL / 已迁移库）则早退。
  if (hasColumn) {
    return;
  }
  await tx.execute(
    `ALTER TABLE ${SMART_SORT_RULE_TABLE} ADD COLUMN capture_kind TEXT NOT NULL DEFAULT 'smart' CHECK (capture_kind IN ('smart', 'fixed_min', 'fixed_max'))`
  );
}

/** smart_sort_rule 加 capture_kind 列的 ADD COLUMN migration。 */
export const addSmartSortCaptureKindV1Migration: SchemaMigration = {
  id: ADD_SMART_SORT_CAPTURE_KIND_V1_ID,
  up: addSmartSortCaptureKindV1Up,
};
