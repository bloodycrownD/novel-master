/**
 * retire-pref-session-fs-version-check-v1 migration 行为测试。
 *
 * 模拟「存量用户库」：先只跑 DDL 建表（不跑 migration runner），
 * 手工写入死键后 bootstrapNovelMaster，覆盖：
 *  1. 死键被删除，schema_migrations 表登记该 id；相邻合法键不受影响；
 *  2. 二次 bootstrap 不重复执行（applied 去重：重塞的死键保留、登记不重复）；
 *  3. 登记表：migration 注册于 SCHEMA_MIGRATIONS 队尾。
 *
 * @module test/bootstrap/retire-pref-session-fs-version-check
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NOVEL_MASTER_SCHEMA_STATEMENTS,
  bootstrapNovelMaster,
  open,
  type TdbcConnection,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { PREFERENCES_MODULE } from "../../src/service/persistent-preferences/impl/preference-keys.js";
import { RETIRE_PREF_SESSION_FS_VERSION_CHECK_V1_ID } from "../../src/bootstrap/schema-migrations/retire-pref-session-fs-version-check-v1.js";
import { SCHEMA_MIGRATIONS } from "../../src/bootstrap/schema-migrations/index.js";

/** 已下线的偏好键（与 migration 内部常量同值，测试侧独立声明防抄错）。 */
const RETIRED_KEY = "session-fs.versionCheck";

/**
 * 打开内存库并只跑全量 DDL（不跑 migration），得到 kkv_entry 已存在、
 * schema_migrations 尚未登记任何 migration 的「存量库形态」。
 */
async function openLegacyShapeConn(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  const conn = await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
  for (const sql of NOVEL_MASTER_SCHEMA_STATEMENTS) {
    await conn.execute(sql);
  }
  return conn;
}

/** 手工写入一条 kkv 偏好行（模拟存量数据）。 */
async function seedKkvRow(
  conn: TdbcConnection,
  key: string
): Promise<void> {
  await conn.execute(
    `INSERT INTO kkv_entry (module, key, value) VALUES (?, ?, ?)`,
    [PREFERENCES_MODULE, key, JSON.stringify({ seeded: true })]
  );
}

async function countKkvRows(
  conn: TdbcConnection,
  key: string
): Promise<number> {
  const rows = await conn.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM kkv_entry WHERE module = ? AND key = ?`,
    [PREFERENCES_MODULE, key]
  );
  return Number(rows[0]?.n ?? 0);
}

async function countMigrationRegistration(
  conn: TdbcConnection
): Promise<number> {
  const rows = await conn.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM schema_migrations WHERE id = ?`,
    [RETIRE_PREF_SESSION_FS_VERSION_CHECK_V1_ID]
  );
  return Number(rows[0]?.n ?? 0);
}

describe("retire-pref-session-fs-version-check-v1 migration", () => {
  it("登记表：migration 注册于 SCHEMA_MIGRATIONS（队尾由 workplace-dir-rule-smart-field-v1 接任）", () => {
    assert.ok(
      SCHEMA_MIGRATIONS.some(
        (migration) => migration.id === RETIRE_PREF_SESSION_FS_VERSION_CHECK_V1_ID
      )
    );
  });

  it("存量死键：bootstrap 后被删除并登记 id，相邻键不受影响", async () => {
    const conn = await openLegacyShapeConn();
    try {
      await seedKkvRow(conn, RETIRED_KEY);
      // 相邻合法偏好键：验证 DELETE 只精确命中死键。
      await seedKkvRow(conn, "chat.llmStream");

      await bootstrapNovelMaster(conn);

      assert.equal(
        await countKkvRows(conn, RETIRED_KEY),
        0,
        "存量死键应被 migration 删除"
      );
      assert.equal(
        await countMigrationRegistration(conn),
        1,
        "schema_migrations 应登记该 migration id"
      );
      assert.equal(
        await countKkvRows(conn, "chat.llmStream"),
        1,
        "同 module 相邻键不应被误删"
      );
    } finally {
      await conn.close();
    }
  });

  it("二次 bootstrap 不重复执行（applied 去重）", async () => {
    const conn = await openLegacyShapeConn();
    try {
      // 第一次 bootstrap：migration 执行并登记。
      await bootstrapNovelMaster(conn);
      assert.equal(await countMigrationRegistration(conn), 1);

      // 模拟外部重塞死键：二次 bootstrap 走 applied 去重，migration 不再
      // 执行，重塞的行应原样保留——反向证明没有第二趟 DELETE。
      await seedKkvRow(conn, RETIRED_KEY);

      await bootstrapNovelMaster(conn);

      assert.equal(
        await countKkvRows(conn, RETIRED_KEY),
        1,
        "applied 去重：重塞的死键应保留（migration 未重复执行）"
      );
      assert.equal(
        await countMigrationRegistration(conn),
        1,
        "登记不应重复"
      );
    } finally {
      await conn.close();
    }
  });
});
