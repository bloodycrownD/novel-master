/**
 * rename-smart-sort-rule-example-v1 migration 行为测试（fix ④）。
 *
 * 覆盖：
 *  1. 登记：migration 已注册于 SCHEMA_MIGRATIONS 阵尾；
 *  2. 迁移语义（up 直调）：example 列 RENAME 为 description、内置行刷新
 *     出厂描述、用户行值原样保留；已是 description 形态时二跑早退；
 *  3. 快路径场景（v13 存量库 + 前序 migration 已 applied）：runner 仍执行
 *     本迁移（pending migration 不受 bootVersion 快路径短路）；
 *  4. 慢路径集成（user_version=0 存量库带 example 形态表）：bootstrap 全流程
 *     后列形态正确、用户行无损、内置行描述为出厂值。
 *
 * 说明：完整 bootstrapNovelMaster 的事务后 seedBuiltinSkills 依赖 kkv_entry
 * 等全套表——最小化模拟库走快路径会缺表，因此快路径场景直接调
 * runPendingSchemaMigrations（与 bootstrap 快路径分支同一入口），慢路径
 * 走完整 bootstrap（DDL 先建全套表，无缺表问题）。
 *
 * @module test/bootstrap/rename-smart-sort-rule-example-v1.test
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
  RENAME_SMART_SORT_RULE_EXAMPLE_V1_ID,
  renameSmartSortRuleExampleV1Up,
} from "../../src/bootstrap/schema-migrations/rename-smart-sort-rule-example-v1.js";
import {
  SCHEMA_MIGRATIONS,
  runPendingSchemaMigrations,
} from "../../src/bootstrap/schema-migrations/index.js";
import { SCHEMA_BOOT_VERSION } from "../../src/bootstrap/novel-master-bootstrap.js";

/** v13 存量用户的 smart_sort_rule 形态（example 列）。 */
const V13_SMART_SORT_DDL = `
  CREATE TABLE IF NOT EXISTS smart_sort_rule (
    rule_id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    pattern TEXT NOT NULL,
    flags TEXT NOT NULL DEFAULT '' CHECK (flags NOT GLOB '*[^gimsuy]*'),
    example TEXT,
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

/** 旧 example 形态表 + 内置/用户行各带旧示例值（不动 user_version，由调用方定）。 */
async function seedLegacyShape(conn: TdbcConnection): Promise<void> {
  await conn.execute(V13_SMART_SORT_DDL);
  await conn.execute(
    `INSERT INTO smart_sort_rule (
       rule_id, name, pattern, flags, example, enabled,
       sort_order, created_at_ms, updated_at_ms
     ) VALUES
       ('builtin-zh-chapter', '中文序号章节', '第([0-9]+)章', '', '第十二章 风起', 1, 1, 1, 1),
       ('user-mine', '我的规则', '^番外([0-9]+)', '', '番外3', 1, 2, 1, 1)`
  );
}

/** 把本迁移之前的既有 migration 登记为 applied（模拟真实 v13 库状态）。 */
async function markPriorMigrationsApplied(conn: TdbcConnection): Promise<void> {
  await conn.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY,
       applied_at_ms INTEGER NOT NULL
     )`
  );
  for (const migration of SCHEMA_MIGRATIONS) {
    if (migration.id === RENAME_SMART_SORT_RULE_EXAMPLE_V1_ID) {
      continue;
    }
    await conn.execute(
      `INSERT OR IGNORE INTO schema_migrations (id, applied_at_ms) VALUES (?, ?)`,
      [migration.id, 1]
    );
  }
}

describe("rename-smart-sort-rule-example-v1 migration", () => {
  it("登记于 SCHEMA_MIGRATIONS 阵尾", () => {
    assert.equal(
      SCHEMA_MIGRATIONS.at(-1)?.id,
      RENAME_SMART_SORT_RULE_EXAMPLE_V1_ID
    );
  });

  it("迁移语义（up 直调）：RENAME 列 + 内置行刷新出厂描述 + 用户行值保留", async () => {
    const conn = await openMemoryConn();
    try {
      await seedLegacyShape(conn);

      await renameSmartSortRuleExampleV1Up(conn);

      const cols = await conn.query<{ name: string }>(
        `SELECT name FROM pragma_table_info('smart_sort_rule')`
      );
      const names = cols.map((r) => String(r.name));
      assert.ok(!names.includes("example"), "example 列应已消失");
      assert.ok(names.includes("description"), "description 列应就位");

      // 内置行 description 刷为出厂描述（不再是旧示例文件名）。
      const builtin = await conn.query<{ description: string | null }>(
        `SELECT description FROM smart_sort_rule WHERE rule_id = 'builtin-zh-chapter'`
      );
      assert.equal(
        builtin[0]?.description,
        "匹配 第X章/节/集/部/篇/回/卷 形式的标题（X 支持中文与阿拉伯数字）"
      );

      // 用户行值原样保留（只改名不重写）。
      const user = await conn.query<{ description: string | null }>(
        `SELECT description FROM smart_sort_rule WHERE rule_id = 'user-mine'`
      );
      assert.equal(user[0]?.description, "番外3");

      // 幂等：已是 description 形态时 up 直调二跑早退不报错、值不动。
      await renameSmartSortRuleExampleV1Up(conn);
      const userAgain = await conn.query<{ description: string | null }>(
        `SELECT description FROM smart_sort_rule WHERE rule_id = 'user-mine'`
      );
      assert.equal(userAgain[0]?.description, "番外3");
    } finally {
      await conn.close();
    }
  });

  it("快路径场景：v13 库（user_version 已达基线、前序已 applied）runner 仍执行本迁移", async () => {
    const conn = await openMemoryConn();
    try {
      await seedLegacyShape(conn);
      await markPriorMigrationsApplied(conn);
      await conn.execute(`PRAGMA user_version = ${SCHEMA_BOOT_VERSION}`);

      await runPendingSchemaMigrations(conn);

      const builtin = await conn.query<{ description: string | null }>(
        `SELECT description FROM smart_sort_rule WHERE rule_id = 'builtin-zh-chapter'`
      );
      assert.equal(
        builtin[0]?.description,
        "匹配 第X章/节/集/部/篇/回/卷 形式的标题（X 支持中文与阿拉伯数字）"
      );
      const applied = await conn.query<{ id: string }>(
        `SELECT id FROM schema_migrations WHERE id = '${RENAME_SMART_SORT_RULE_EXAMPLE_V1_ID}'`
      );
      assert.equal(applied.length, 1, "迁移应登记 applied");
    } finally {
      await conn.close();
    }
  });

  it("慢路径集成：user_version=0 存量库 bootstrap 后形态正确、用户行无损", async () => {
    const conn = await openMemoryConn();
    try {
      await seedLegacyShape(conn);

      await bootstrapNovelMaster(conn);

      const cols = await conn.query<{ name: string }>(
        `SELECT name FROM pragma_table_info('smart_sort_rule')`
      );
      const names = cols.map((r) => String(r.name));
      assert.ok(!names.includes("example"), "example 列应已消失");
      assert.ok(names.includes("description"), "description 列应就位");

      const user = await conn.query<{ description: string | null }>(
        `SELECT description FROM smart_sort_rule WHERE rule_id = 'user-mine'`
      );
      assert.equal(user[0]?.description, "番外3", "用户行值经迁移保留");

      const builtin = await conn.query<{ description: string | null }>(
        `SELECT description FROM smart_sort_rule WHERE rule_id = 'builtin-zh-chapter'`
      );
      assert.equal(
        builtin[0]?.description,
        "匹配 第X章/节/集/部/篇/回/卷 形式的标题（X 支持中文与阿拉伯数字）"
      );
    } finally {
      await conn.close();
    }
  });
});
