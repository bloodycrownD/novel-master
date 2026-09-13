/**
 * add-smart-sort-capture-kind-v1 migration 行为测试（fix-capture-kind / D13）。
 *
 * 覆盖：
 *  1. 登记：migration 注册于 SCHEMA_MIGRATIONS 阵尾；
 *  2. 迁移语义（up 直调）：v13 形态表（有 description、无 capture_kind）
 *     ALTER ADD COLUMN 带 CHECK；存量行自动默认 'smart'；新列可写
 *     fixed_min/fixed_max、非法值被 CHECK 拒；已是新形态时二跑早退；
 *  3. 快路径场景（v13 存量库 + 前序 migration 已 applied）：runner 仍执行
 *     本迁移（pending migration 不受 bootVersion 快路径短路）；
 *  4. bootstrap 集成：全流程后三条 fixed 档内置规则种入、四条存量内置
 *     语义零变化（capture_kind 全 smart）。
 *
 * @module test/bootstrap/add-smart-sort-capture-kind-v1.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapNovelMaster, open } from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import type { TdbcConnection } from "@novel-master/core";
import {
  ADD_SMART_SORT_CAPTURE_KIND_V1_ID,
  addSmartSortCaptureKindV1Up,
} from "../../src/bootstrap/schema-migrations/add-smart-sort-capture-kind-v1.js";
import {
  SCHEMA_MIGRATIONS,
  runPendingSchemaMigrations,
} from "../../src/bootstrap/schema-migrations/index.js";

/** v13 存量用户的 smart_sort_rule 形态（description 就位、无 capture_kind）。 */
const V13_SMART_SORT_DDL = `
  CREATE TABLE IF NOT EXISTS smart_sort_rule (
    rule_id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    pattern TEXT NOT NULL,
    flags TEXT NOT NULL DEFAULT '' CHECK (flags NOT GLOB '*[^gimsuy]*'),
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    sort_order INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )
`;

async function openMemoryConn(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  const conn = await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
  return conn;
}

/** v13 形态表 + 内置/用户行（capture_kind 列尚不存在）。 */
async function seedV13Shape(conn: TdbcConnection): Promise<void> {
  await conn.execute(V13_SMART_SORT_DDL);
  await conn.execute(
    `INSERT INTO smart_sort_rule (
       rule_id, name, pattern, flags, description, enabled,
       sort_order, created_at_ms, updated_at_ms
     ) VALUES
       ('builtin-zh-chapter', '中文序号章节', '第([0-9〇零一二两三四五六七八九十百千]+)章', '', '描述', 1, 1, 1, 1),
       ('user-mine', '我的规则', '^番外([0-9]+)', '', '番外说明', 1, 2, 1, 1)`
  );
}

/** 除本迁移外全部登记为 applied（模拟 v13 存量库状态）。 */
async function markPriorMigrationsApplied(conn: TdbcConnection): Promise<void> {
  await conn.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY,
       applied_at_ms INTEGER NOT NULL
     )`
  );
  for (const migration of SCHEMA_MIGRATIONS) {
    if (migration.id === ADD_SMART_SORT_CAPTURE_KIND_V1_ID) {
      continue;
    }
    await conn.execute(
      `INSERT OR IGNORE INTO schema_migrations (id, applied_at_ms) VALUES (?, ?)`,
      [migration.id, 1]
    );
  }
}

describe("add-smart-sort-capture-kind-v1 migration", () => {
  it("登记于 SCHEMA_MIGRATIONS 阵尾", () => {
    assert.equal(SCHEMA_MIGRATIONS.at(-1)?.id, ADD_SMART_SORT_CAPTURE_KIND_V1_ID);
  });

  it("迁移语义（up 直调）：加列 + 存量行默认 smart + CHECK 拒非法值 + 幂等", async () => {
    const conn = await openMemoryConn();
    try {
      await seedV13Shape(conn);

      await addSmartSortCaptureKindV1Up(conn);

      const cols = await conn.query<{ name: string }>(
        `SELECT name FROM pragma_table_info('smart_sort_rule')`
      );
      assert.ok(
        cols.map((r) => String(r.name)).includes("capture_kind"),
        "capture_kind 列应就位"
      );

      // 存量行（含用户规则）自动默认 smart，无需回填。
      const kinds = await conn.query<{ capture_kind: string }>(
        `SELECT capture_kind FROM smart_sort_rule ORDER BY rule_id`
      );
      assert.deepEqual(
        kinds.map((r) => r.capture_kind),
        ["smart", "smart"]
      );

      // 新列三档可写；非法值被 CHECK 拒（约束随 ADD COLUMN 生效）。
      await conn.execute(
        `UPDATE smart_sort_rule SET capture_kind = 'fixed_min' WHERE rule_id = 'user-mine'`
      );
      await conn.execute(
        `UPDATE smart_sort_rule SET capture_kind = 'fixed_max' WHERE rule_id = 'builtin-zh-chapter'`
      );
      await assert.rejects(
        () =>
          conn.execute(
            `UPDATE smart_sort_rule SET capture_kind = 'bogus' WHERE rule_id = 'user-mine'`
          ),
        /CHECK constraint failed/i
      );

      // 幂等：已是新形态时 up 直调二跑早退不报错。
      await addSmartSortCaptureKindV1Up(conn);
      const again = await conn.query<{ capture_kind: string }>(
        `SELECT capture_kind FROM smart_sort_rule WHERE rule_id = 'user-mine'`
      );
      assert.equal(again[0]?.capture_kind, "fixed_min");
    } finally {
      await conn.close();
    }
  });

  it("快路径场景：v13 库（前序已 applied、user_version 达基线）runner 仍执行本迁移", async () => {
    const conn = await openMemoryConn();
    try {
      await seedV13Shape(conn);
      await markPriorMigrationsApplied(conn);
      await conn.execute(`PRAGMA user_version = 13`);

      await runPendingSchemaMigrations(conn);

      const cols = await conn.query<{ name: string }>(
        `SELECT name FROM pragma_table_info('smart_sort_rule')`
      );
      assert.ok(
        cols.map((r) => String(r.name)).includes("capture_kind"),
        "快路径仍应补列"
      );
      const applied = await conn.query<{ id: string }>(
        `SELECT id FROM schema_migrations WHERE id = '${ADD_SMART_SORT_CAPTURE_KIND_V1_ID}'`
      );
      assert.equal(applied.length, 1, "迁移应登记 applied");
    } finally {
      await conn.close();
    }
  });

  it("bootstrap 集成：存量四条内置全 smart、三条 fixed 档新内置种入", async () => {
    const conn = await openMemoryConn();
    try {
      await seedV13Shape(conn);

      await bootstrapNovelMaster(conn);

      const rows = await conn.query<{
        rule_id: string;
        capture_kind: string;
      }>(
        `SELECT rule_id, capture_kind FROM smart_sort_rule ORDER BY rule_id`
      );
      const byId = new Map(rows.map((r) => [r.rule_id, r.capture_kind]));
      // 存量行（含 v13 库里已存在的 builtin-zh-chapter 与用户规则）默认 smart。
      assert.equal(byId.get("builtin-zh-chapter"), "smart");
      assert.equal(byId.get("user-mine"), "smart");
      // 三条 fixed 档新内置经 seed 种入（INSERT OR IGNORE 新行）。
      assert.equal(byId.get("builtin-zh-prologue"), "fixed_min");
      assert.equal(byId.get("builtin-zh-finale"), "fixed_max");
      assert.equal(byId.get("builtin-zh-extra"), "fixed_max");
    } finally {
      await conn.close();
    }
  });
});
