/**
 * workplace-dir-rule-smart-field-v1 migration 行为测试（T-MIG1 / T-MIG2）。
 *
 * 覆盖：
 *  1. 登记：migration 已注册于 SCHEMA_MIGRATIONS 阵尾；
 *  2. T-MIG1：旧 CHECK 形态库（v10 存量形态）→ bootstrap 后写 'smart' 成功、
 *     存量行无损、CHECK 仍拦截非法值、幂等重跑（快路径二跑 + up 直调早退）；
 *  3. T-MIG2：快/慢路径均执行 pending migration（新表在存量库建出；
 *     抹掉 applied 记录后快路径重跑安全）。
 *
 * @module test/bootstrap/workplace-dir-rule-smart-field-v1.test
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
  WORKPLACE_DIR_RULE_SMART_FIELD_V1_ID,
  workplaceDirRuleSmartFieldV1Up,
} from "../../src/bootstrap/schema-migrations/workplace-dir-rule-smart-field-v1.js";
import { SCHEMA_MIGRATIONS } from "../../src/bootstrap/schema-migrations/index.js";
import { SCHEMA_BOOT_VERSION } from "../../src/bootstrap/novel-master-bootstrap.js";


/** v10 存量用户的 workplace_dir_rule 形态（table-constraints-v1b 约束版，无 'smart'）。 */
const V10_DIR_RULE_DDL = `
  CREATE TABLE IF NOT EXISTS workplace_dir_rule (
    scope_key TEXT NOT NULL,
    logical_path TEXT NOT NULL,
    rule_enabled INTEGER NOT NULL DEFAULT 1 CHECK (rule_enabled IN (0, 1)),
    sort_field TEXT NOT NULL DEFAULT 'name' CHECK (sort_field IN ('name', 'created', 'updated')),
    sort_order TEXT NOT NULL DEFAULT 'asc' CHECK (sort_order IN ('asc', 'desc')),
    head_count INTEGER NOT NULL DEFAULT 0 CHECK (head_count >= 0),
    tail_count INTEGER NOT NULL DEFAULT 1000 CHECK (tail_count >= 0),
    fill_policy TEXT NOT NULL DEFAULT 'header' CHECK (fill_policy IN ('hidden', 'filename', 'header', 'full')),
    PRIMARY KEY (scope_key, logical_path)
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

/** 构造 v10 形态库：旧 CHECK 表 + 两行存量规则 + user_version=10。 */
async function seedV10DirRules(conn: TdbcConnection): Promise<void> {
  await conn.execute(V10_DIR_RULE_DDL);
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_workplace_dir_scope ON workplace_dir_rule(scope_key)`
  );
  await conn.execute(
    `INSERT INTO workplace_dir_rule (
       scope_key, logical_path, rule_enabled, sort_field, sort_order,
       head_count, tail_count, fill_policy
     ) VALUES ('project:book', '/chapters', 1, 'name', 'asc', 0, 1000, 'header')`
  );
  await conn.execute(
    `INSERT INTO workplace_dir_rule (
       scope_key, logical_path, rule_enabled, sort_field, sort_order,
       head_count, tail_count, fill_policy
     ) VALUES ('project:book', '/', 0, 'created', 'desc', 5, 20, 'filename')`
  );
  await conn.execute(`PRAGMA user_version = 10`);
}

type DirRuleRow = {
  scope_key: string;
  logical_path: string;
  rule_enabled: number;
  sort_field: string;
  sort_order: string;
  head_count: number;
  tail_count: number;
  fill_policy: string;
};

async function readDirRules(
  conn: TdbcConnection
): Promise<DirRuleRow[]> {
  return await conn.query<DirRuleRow>(
    `SELECT scope_key, logical_path, rule_enabled, sort_field, sort_order,
            head_count, tail_count, fill_policy
     FROM workplace_dir_rule ORDER BY logical_path`
  );
}

describe("workplace-dir-rule-smart-field-v1 migration（T-MIG1/T-MIG2）", () => {
  it("登记：migration 已注册于 SCHEMA_MIGRATIONS（数组尾部）", () => {
    const last = SCHEMA_MIGRATIONS[SCHEMA_MIGRATIONS.length - 1];
    assert.equal(last?.id, WORKPLACE_DIR_RULE_SMART_FIELD_V1_ID);
  });

  it("T-MIG1：旧 CHECK 形态库 bootstrap 后可写 'smart'、存量行无损、CHECK 仍拦截非法值", async () => {
    const conn = await openMemoryConn();
    try {
      await seedV10DirRules(conn);
      const before = await readDirRules(conn);

      await bootstrapNovelMaster(conn);

      // 新 CHECK 形态生效：'smart' 可写、非法值仍被拒。
      await conn.execute(
        `INSERT INTO workplace_dir_rule (
           scope_key, logical_path, rule_enabled, sort_field, sort_order,
           head_count, tail_count, fill_policy
         ) VALUES ('project:book', '/vols', 1, 'smart', 'asc', 0, 1000, 'header')`
      );
      await assert.rejects(
        conn.execute(
          `INSERT INTO workplace_dir_rule (
             scope_key, logical_path, rule_enabled, sort_field, sort_order,
             head_count, tail_count, fill_policy
           ) VALUES ('project:book', '/bad', 1, 'bogus', 'asc', 0, 1000, 'header')`
        ),
        /constraint|CHECK/i
      );

      // 存量两行逐字段无损（含禁用行与非默认值）。
      const after = await readDirRules(conn);
      assert.equal(after.length, 3);
      assert.deepEqual(after.slice(0, 2), before);

      // 建表 SQL 已是含 'smart' 形态；scope 索引随 rebuild 重建。
      const ddlRows = await conn.query<{ sql: string | null }>(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'workplace_dir_rule'`
      );
      assert.ok(String(ddlRows[0]?.sql ?? "").includes("'smart'"));
      const idxRows = await conn.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_workplace_dir_scope'`
      );
      assert.equal(idxRows.length, 1);

      // migration 已登记。
      const applied = await conn.query<{ id: string }>(
        `SELECT id FROM schema_migrations WHERE id = '${WORKPLACE_DIR_RULE_SMART_FIELD_V1_ID}'`
      );
      assert.equal(applied.length, 1);
    } finally {
      await conn.close();
    }
  });

  it("T-MIG1 幂等：bootstrap 二跑（快路径）与 up 直调（探测早退）均零副作用", async () => {
    const conn = await openMemoryConn();
    try {
      await seedV10DirRules(conn);
      await bootstrapNovelMaster(conn);
      const snapshotAfterFirst = await readDirRules(conn);
      const userVersion = await conn.query<{ user_version: number }>(
        `PRAGMA user_version`
      );
      // 合并 origin/main 后 BOOT_VERSION 顺延为 13（main 已发布 v11/v12），
      // 断言引用常量而非硬编码，避免后续 bump 再漂移。
      assert.equal(Number(userVersion[0]?.user_version ?? 0), SCHEMA_BOOT_VERSION);

      // 二跑：user_version 达到 BOOT_VERSION 走快路径，migration applied 跳过，不炸。
      await bootstrapNovelMaster(conn);
      assert.deepEqual(await readDirRules(conn), snapshotAfterFirst);

      // up 直调（模拟 applied 记录丢失后的重跑）：形态探测早退，行无损。
      await workplaceDirRuleSmartFieldV1Up(conn);
      assert.deepEqual(await readDirRules(conn), snapshotAfterFirst);
    } finally {
      await conn.close();
    }
  });

  it("T-MIG2 慢路径：v10 存量库 bootstrap 后新表 smart_sort_rule 建出", async () => {
    const conn = await openMemoryConn();
    try {
      await seedV10DirRules(conn);
      await bootstrapNovelMaster(conn);

      const tables = await conn.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'smart_sort_rule'`
      );
      assert.equal(tables.length, 1, "smart_sort_rule 应在存量库建出");
      const idx = await conn.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_smart_sort_rule_order'`
      );
      assert.equal(idx.length, 1);
    } finally {
      await conn.close();
    }
  });

  it("T-MIG2 快路径：applied 记录被抹掉后快路径仍执行 pending migration（早退安全）", async () => {
    const conn = await openMemoryConn();
    try {
      // 完整 bootstrap 一次：升至 BOOT_VERSION + migration applied。
      await bootstrapNovelMaster(conn);
      await conn.execute(
        `INSERT INTO workplace_dir_rule (
           scope_key, logical_path, rule_enabled, sort_field, sort_order,
           head_count, tail_count, fill_policy
         ) VALUES ('project:book', '/chapters', 1, 'smart', 'asc', 0, 1000, 'header')`
      );

      // 模拟异常态：抹掉 applied 记录（user_version 仍达 BOOT_VERSION → 快路径）。
      await conn.execute(
        `DELETE FROM schema_migrations WHERE id = '${WORKPLACE_DIR_RULE_SMART_FIELD_V1_ID}'`
      );

      // 快路径仍会跑 pending migration：已是目标形态 → 探测早退 → 无损。
      await bootstrapNovelMaster(conn);
      const rules = await readDirRules(conn);
      assert.equal(rules.length, 1);
      assert.equal(rules[0]?.sort_field, "smart");

      // applied 重新登记（runner 幂等收尾）。
      const applied = await conn.query<{ id: string }>(
        `SELECT id FROM schema_migrations WHERE id = '${WORKPLACE_DIR_RULE_SMART_FIELD_V1_ID}'`
      );
      assert.equal(applied.length, 1);
    } finally {
      await conn.close();
    }
  });
});
