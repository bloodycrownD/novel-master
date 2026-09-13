/**
 * workplace-dir-rule-smart-field-v1：workplace_dir_rule 的 sort_field CHECK
 * 扩枚举 'smart'（rebuild 迁移）。
 *
 * 背景：SQLite 无法 ALTER 已存在表的 CHECK 约束，canonical DDL 的
 * `CREATE TABLE IF NOT EXISTS` 对旧表也不生效——v10 存量库必须整表 rebuild
 * 成新 CHECK 形态，否则写入 sort_field='smart' 直接撞 CHECK 拒绝。本迁移是
 * SCHEMA_BOOT_VERSION v11 三件套（canonical DDL + bump + rebuild）的第三件
 * （v9/v10 同型事故的教训，见 novel-master-bootstrap 注释链）。
 *
 * rebuildTable 照抄退役的 table-constraints-v1b（git 5d271868^）模板：按
 * rowid 游标分块搬运（quick-sqlite 的 async execute 对无 LIMIT 的整表
 * INSERT SELECT 会挂起，真机实测 promise 永远 pending）、只搬新旧表共有列
 * （本迁移在 bootstrap 流程里跑在 alignSchemaColumns 之前，老库可能有列
 * 尚未补齐）。
 *
 * 幂等：开头查 sqlite_master 的建表 SQL 是否已含 `'smart'`（本迁移的独有
 * 形态变化，workplace_dir_rule 既有列名不含该子串）——已是目标形态则整个
 * up 早退；查询异常/空结果的保守方向是重跑（rebuild 幂等，重复执行无害，
 * 方向判断依据见 table-constraints-v1 的真机事故记录）。
 *
 * @module bootstrap/schema-migrations/workplace-dir-rule-smart-field-v1
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import {
  WORKPLACE_DIR_RULE_TABLE,
  WORKPLACE_DIR_SCOPE_INDEX,
} from "../workplace/workplace-schema.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const WORKPLACE_DIR_RULE_SMART_FIELD_V1_ID =
  "workplace-dir-rule-smart-field-v1";

/**
 * 新表体：与 v11 canonical DDL（workplace-schema.ts）同形，CHECK 扩 'smart'。
 * 迁移是历史快照，此处硬编码 v11 形态、不随 canonical 后续演进漂移。
 */
const NEW_DIR_RULE_BODY_DDL = `(
    scope_key TEXT NOT NULL,
    logical_path TEXT NOT NULL,
    rule_enabled INTEGER NOT NULL DEFAULT 1 CHECK (rule_enabled IN (0, 1)),
    sort_field TEXT NOT NULL DEFAULT 'name' CHECK (sort_field IN ('name', 'created', 'updated', 'smart')),
    sort_order TEXT NOT NULL DEFAULT 'asc' CHECK (sort_order IN ('asc', 'desc')),
    head_count INTEGER NOT NULL DEFAULT 0 CHECK (head_count >= 0),
    tail_count INTEGER NOT NULL DEFAULT 1000 CHECK (tail_count >= 0),
    fill_policy TEXT NOT NULL DEFAULT 'header' CHECK (fill_policy IN ('hidden', 'filename', 'header', 'full')),
    PRIMARY KEY (scope_key, logical_path)
  )`;

/**
 * 探测 workplace_dir_rule 是否已是含 'smart' 的新 CHECK 形态（即本迁移
 * 是否已 apply）。查 sqlite_master 的建表 SQL，不用 pragma_table_info——
 * CHECK 约束文本只存在于建表 SQL 里。
 */
async function isAlreadySmartField(
  tx: TdbcConnection
): Promise<boolean> {
  const rows = await tx.query<{ sql: string | null }>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${WORKPLACE_DIR_RULE_TABLE}'`
  );
  if (rows.length === 0 || rows[0]?.sql == null) {
    // 查询异常/空结果的保守方向是 false（重跑）：rebuild 幂等、重复执行
    // 无害；误判 true 会让 CHECK 永远缺失（真机 disk I/O error 中间态事故
    // 的方向性教训，见 table-constraints-v1b 头注释）。
    console.warn(
      `[${WORKPLACE_DIR_RULE_SMART_FIELD_V1_ID}] 探测 workplace_dir_rule 形态失败（sqlite_master 无结果），按未迁移处理`
    );
    return false;
  }
  return String(rows[0]?.sql ?? "").includes("'smart'");
}

/**
 * 整表 rebuild（table-constraints-v1b 模板）：建临时新表 → rowid 分块搬运
 * 共有列 → DROP 旧表 → 改名 → 重建附属索引。
 *
 * INSERT 只搬「旧表与新表共有」的列（按旧表顺序取交集），缺失列由新表
 * DEFAULT/NULL 兜底。本迁移中两表列集相同（CHECK 变更不动列），交集逻辑
 * 保留是为通用形态兜底（老库列序漂移时依然安全）。
 */
async function rebuildTable(
  txOrig: TdbcConnection,
  table: string,
  newBodyDdl: string,
  recreateSqls: readonly string[] = []
): Promise<void> {
  const tx = txOrig;
  const tmp = `${table}__nm_smart_new`;
  // 读旧表列名（顺序敏感，决定 INSERT 列序）。
  const oldCols = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${table}')`
  );
  const oldColNames = oldCols.map((r) => String(r.name));

  await tx.execute(`DROP TABLE IF EXISTS ${tmp}`);
  await tx.execute(`CREATE TABLE ${tmp} ${newBodyDdl}`);

  // 读新表列名，取交集（旧表有且新表也有的列）。
  const newCols = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${tmp}')`
  );
  const newColSet = new Set(newCols.map((r) => String(r.name)));
  const common = oldColNames.filter((c) => newColSet.has(c));
  const colList = common.map((c) => `"${c}"`).join(", ");

  // 旧表此刻仍是 rowid 表，按 rowid 游标分块搬运，而不是单条整表
  // `INSERT ... SELECT`。原因（v1b 真机实测结论）：
  // 1) quick-sqlite 的 async execute 对无 LIMIT 的整表 INSERT SELECT 会挂起
  //    （promise 永远 pending）；分块后单条执行时间短，async 稳定。
  // 2) 不能改用逐条参数化 INSERT：3 万行逐条同步执行霸占 JS 线程 4 分钟
  //    以上，触发 ANR 被杀；块状 INSERT SELECT 是引擎内部搬运，快得多。
  const COPY_CHUNK = 100;
  let cursor = -1;
  for (;;) {
    const batch = await tx.query<{ r: number | bigint }>(
      `SELECT rowid AS r FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ${COPY_CHUNK}`,
      [cursor]
    );
    if (batch.length === 0) {
      break;
    }
    const lo = Number(batch[0]!.r);
    const hi = Number(batch[batch.length - 1]!.r);
    await tx.execute(
      `INSERT INTO ${tmp} (${colList}) SELECT ${colList} FROM ${table} WHERE rowid >= ? AND rowid <= ?`,
      [lo, hi]
    );
    cursor = hi;
  }

  await tx.execute(`DROP TABLE ${table}`);
  await tx.execute(`ALTER TABLE ${tmp} RENAME TO ${table}`);
  for (const sql of recreateSqls) {
    await tx.execute(sql);
  }
}

/** 供测试直接调用的迁移主体。 */
export async function workplaceDirRuleSmartFieldV1Up(
  tx: TdbcConnection
): Promise<void> {
  if (await isAlreadySmartField(tx)) {
    return;
  }
  await rebuildTable(tx, WORKPLACE_DIR_RULE_TABLE, NEW_DIR_RULE_BODY_DDL, [
    `CREATE INDEX IF NOT EXISTS ${WORKPLACE_DIR_SCOPE_INDEX} ON ${WORKPLACE_DIR_RULE_TABLE}(scope_key)`,
  ]);
}

/** workplace_dir_rule sort_field CHECK 扩 'smart' 的 rebuild migration。 */
export const workplaceDirRuleSmartFieldV1Migration: SchemaMigration = {
  id: WORKPLACE_DIR_RULE_SMART_FIELD_V1_ID,
  up: workplaceDirRuleSmartFieldV1Up,
};
