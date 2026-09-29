/**
 * `idx_vfs_entry_content_hash` schema 升级测试（W1-P0）。
 *
 * 校验 content_hash 索引在三种场景下的行为（照 vfs-content-pack-schema.test.ts
 * 的索引断言手法）：
 *  1. 新建库 bootstrap 后由 canonical DDL 直接建出；
 *  2. 老库（user_version 落后一代、缺索引）bootstrap 后走慢路径补建
 *     （v17 存量库的真实升级链 17→18 会建出——本分支 v18 未发布，
 *     BOOT 不因该索引单独 bump 的前提就在此）；
 *  3. 已升版库再 bootstrap 走快路径，DDL 不重跑（删索引后不重建）。
 *
 * 另附查询计划断言：打包候选谓词的 `NOT EXISTS (vfs_entry.content_hash)` 反查
 * 命中该索引（索引与用途绑定，防「建了但谓词不走」的静默失效）。
 *
 * @module test/bootstrap/vfs-entry-content-hash-index.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bootstrapNovelMaster,
  open,
  SCHEMA_BOOT_VERSION,
  type TdbcConnection,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { BASELINE_TOO_OLD_MESSAGE } from "../../src/bootstrap/novel-master-bootstrap.js";
import { execLegacyVfsEntryTable } from "./helpers/legacy-db-fixtures.js";

const INDEX_NAME = "idx_vfs_entry_content_hash";

async function openInMemoryConnection(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  return await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
}

async function sqliteMasterSql(
  conn: TdbcConnection,
  type: "table" | "index",
  name: string
): Promise<string | null> {
  const rows = await conn.query<{ sql: string | null }>(
    `SELECT sql FROM sqlite_master WHERE type = '${type}' AND name = '${name}'`
  );
  return rows[0]?.sql ?? null;
}

async function indexExists(conn: TdbcConnection): Promise<boolean> {
  return (await sqliteMasterSql(conn, "index", INDEX_NAME)) != null;
}

async function readUserVersion(conn: TdbcConnection): Promise<number> {
  const rows = await conn.query<{ user_version: number }>(
    "PRAGMA user_version"
  );
  return Number(rows[0]?.user_version ?? 0);
}

describe("idx_vfs_entry_content_hash schema 升级（W1-P0）", () => {
  it("新建库 bootstrap 后由 DDL 直接建出 content_hash 索引", async () => {
    const conn = await openInMemoryConnection();
    try {
      await bootstrapNovelMaster(conn);

      const indexSql = await sqliteMasterSql(conn, "index", INDEX_NAME);
      assert.ok(indexSql != null, `${INDEX_NAME} 索引应随 DDL 建出`);
      // 索引列锁定为 vfs_entry(content_hash)（防建错表/错列）。
      assert.match(indexSql ?? "", /ON\s+vfs_entry\s*\(\s*content_hash\s*\)/i);
      assert.equal(await readUserVersion(conn), SCHEMA_BOOT_VERSION);
    } finally {
      await conn.close();
    }
  });

  it("老库（落后一代、缺索引）bootstrap 后慢路径补建索引并升版", async () => {
    const conn = await openInMemoryConnection();
    try {
      // 模拟「已升版到上一代」的老库：完整 bootstrap 后删索引、把
      // user_version 钉回 SCHEMA_BOOT_VERSION - 1，下次 bootstrap 走慢路径。
      await bootstrapNovelMaster(conn);
      await conn.execute(`DROP INDEX IF EXISTS ${INDEX_NAME}`);
      await conn.execute(`PRAGMA user_version = ${SCHEMA_BOOT_VERSION - 1}`);
      assert.equal(await indexExists(conn), false);

      await bootstrapNovelMaster(conn);

      assert.equal(
        await indexExists(conn),
        true,
        "老库升级后应由慢路径 DDL 补建 content_hash 索引"
      );
      assert.equal(await readUserVersion(conn), SCHEMA_BOOT_VERSION);
    } finally {
      await conn.close();
    }
  });

  it("已升版库再 bootstrap 走快路径，DDL 不重跑（删索引后不重建）", async () => {
    const conn = await openInMemoryConnection();
    try {
      await bootstrapNovelMaster(conn);
      // 版本保持 SCHEMA_BOOT_VERSION 不动，仅删索引——再 bootstrap 走快路径
      // 跳过全部 DDL，索引不应被重建（快路径「不建」的直证；真实库里该形态
      // 只会来自外部改动，快路径的合同就是信任 user_version；分支内测试机
      // 已落 v18 的库同此形态，不补建是已登记的可接受限制）。
      await conn.execute(`DROP INDEX IF EXISTS ${INDEX_NAME}`);
      assert.equal(await readUserVersion(conn), SCHEMA_BOOT_VERSION);

      await bootstrapNovelMaster(conn);

      assert.equal(
        await indexExists(conn),
        false,
        "快路径不应重跑 DDL 建 content_hash 索引"
      );
      assert.equal(await readUserVersion(conn), SCHEMA_BOOT_VERSION);
    } finally {
      await conn.close();
    }
  });

  it("打包候选谓词的 head 引用反查命中 content_hash 索引", async () => {
    const conn = await openInMemoryConnection();
    try {
      await bootstrapNovelMaster(conn);

      // collectCandidateEntries 同款谓词（NOT EXISTS 反查 vfs_entry.content_hash）。
      const plan = await conn.query<{ detail: string }>(
        `EXPLAIN QUERY PLAN
         SELECT r.entry_id, r.version, r.content_hash, b.byte_len
         FROM vfs_revision r
         JOIN vfs_content_blob b ON b.content_hash = r.content_hash
         WHERE r.status = 'active'
           AND r.content_hash IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM vfs_entry e WHERE e.content_hash = r.content_hash)
         ORDER BY r.entry_id, r.version`
      );
      const details = plan.map((row) => String(row.detail)).join("\n");
      assert.match(
        details,
        new RegExp(INDEX_NAME),
        `候选谓词应命中 ${INDEX_NAME}（实际计划：\n${details}）`
      );
    } finally {
      await conn.close();
    }
  });

  it("legacy vfs_entry（path 主键、无 content_hash 列）仍先给基线升级提示，不炸索引 DDL", async () => {
    const conn = await openInMemoryConnection();
    try {
      // pre-v1.4.27 形态：vfs_entry 以 path 为主键、无 content_hash 列。
      // 索引 DDL 若先于基线检查执行会以「no such column: content_hash」炸掉，
      // 顶掉本应给出的升级提示——本用例锁定「基线检查先于 DDL」的顺序。
      await execLegacyVfsEntryTable(conn);

      await assert.rejects(
        () => bootstrapNovelMaster(conn),
        (error: unknown) =>
          error instanceof Error && error.message === BASELINE_TOO_OLD_MESSAGE,
        "legacy vfs_entry 应由基线检查拦下并给出升级提示"
      );
    } finally {
      await conn.close();
    }
  });
});
