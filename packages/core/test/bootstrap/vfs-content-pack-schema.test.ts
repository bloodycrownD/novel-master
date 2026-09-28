/**
 * vfs_content_pack 两表 schema 升级测试（T-VP17）。
 *
 * 校验 `vfs_content_pack` / `vfs_content_pack_member` 在三种场景下的行为：
 *  1. 新建库 bootstrap 后由 DDL 直接建出两表与索引；
 *  2. 老库（user_version 落后一代、无两表）bootstrap 后走慢路径补建；
 *  3. 已升版库再 bootstrap 走快路径，DDL 不重跑（删表后不重建）。
 *
 * 断言引用 SCHEMA_BOOT_VERSION 常量而非字面量，随版本 bump 自适应。
 *
 * @module test/bootstrap/vfs-content-pack-schema.test
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

async function tableExists(
  conn: TdbcConnection,
  table: string
): Promise<boolean> {
  return (await sqliteMasterSql(conn, "table", table)) != null;
}

async function readUserVersion(conn: TdbcConnection): Promise<number> {
  const rows = await conn.query<{ user_version: number }>(
    "PRAGMA user_version"
  );
  return Number(rows[0]?.user_version ?? 0);
}

/** 删掉两张 pack 表（member 表的索引随表消亡），模拟未建表的上一代库。 */
async function dropPackTables(conn: TdbcConnection): Promise<void> {
  await conn.execute("DROP TABLE IF EXISTS vfs_content_pack_member");
  await conn.execute("DROP TABLE IF EXISTS vfs_content_pack");
}

describe("vfs_content_pack 两表 schema 升级（T-VP17）", () => {
  it("新建库 bootstrap 后由 DDL 直接建出两表与索引", async () => {
    const conn = await openInMemoryConnection();
    try {
      await bootstrapNovelMaster(conn);

      assert.equal(await tableExists(conn, "vfs_content_pack"), true);
      assert.equal(await tableExists(conn, "vfs_content_pack_member"), true);

      // 索引随 DDL 建出；member 表锁定 WITHOUT ROWID 形态（照
      // hasLegacyVfsRevisionShape 的 sqlite_master 判据手法）。
      const memberIndexSql = await sqliteMasterSql(
        conn,
        "index",
        "idx_vfs_content_pack_member_pack"
      );
      assert.ok(
        memberIndexSql != null,
        "idx_vfs_content_pack_member_pack 索引应随 DDL 建出"
      );
      const memberTableSql = await sqliteMasterSql(
        conn,
        "table",
        "vfs_content_pack_member"
      );
      assert.match(memberTableSql ?? "", /WITHOUT\s+ROWID/i);

      assert.equal(await readUserVersion(conn), SCHEMA_BOOT_VERSION);
    } finally {
      await conn.close();
    }
  });

  it("老库（落后一代、缺两表）bootstrap 后慢路径补建表并升版", async () => {
    const conn = await openInMemoryConnection();
    try {
      // 模拟「已升版到上一代」的老库：完整 bootstrap 后删掉两表、
      // 把 user_version 钉回 SCHEMA_BOOT_VERSION - 1，下次 bootstrap
      // 会走「版本落后 → 跑 DDL」的慢路径。
      await bootstrapNovelMaster(conn);
      await dropPackTables(conn);
      await conn.execute(`PRAGMA user_version = ${SCHEMA_BOOT_VERSION - 1}`);
      assert.equal(await tableExists(conn, "vfs_content_pack"), false);
      assert.equal(await tableExists(conn, "vfs_content_pack_member"), false);

      await bootstrapNovelMaster(conn);

      assert.equal(
        await tableExists(conn, "vfs_content_pack"),
        true,
        "老库升级后应由慢路径 DDL 补建 vfs_content_pack"
      );
      assert.equal(
        await tableExists(conn, "vfs_content_pack_member"),
        true,
        "老库升级后应由慢路径 DDL 补建 vfs_content_pack_member"
      );
      assert.ok(
        (await sqliteMasterSql(
          conn,
          "index",
          "idx_vfs_content_pack_member_pack"
        )) != null,
        "老库升级后应由慢路径 DDL 补建 idx_vfs_content_pack_member_pack"
      );
      assert.equal(await readUserVersion(conn), SCHEMA_BOOT_VERSION);

      // 建出的表可正常写入：pack 头行 + member 行，列清单与 CHECK 值域
      // 与仓储契约一致（format 只认两种打包形态）。
      await conn.execute(`
        INSERT INTO vfs_content_pack (
          entry_id, format, bytes, byte_len, member_count, created_at_ms
        ) VALUES (1, 'fossil-chain-v1', x'789c', 4, 1, 1)
      `);
      await conn.execute(`
        INSERT INTO vfs_content_pack_member (
          content_hash, pack_id, offset, length, compressed_byte_len
        ) VALUES ('sha-abc', 1, 0, 10, 4)
      `);
      await assert.rejects(() =>
        conn.execute(`
          INSERT INTO vfs_content_pack (
            entry_id, format, bytes, byte_len, member_count, created_at_ms
          ) VALUES (1, 'raw', x'789c', 4, 1, 1)
        `)
      );
    } finally {
      await conn.close();
    }
  });

  it("已升版库再 bootstrap 走快路径，DDL 不重跑（删表后不重建）", async () => {
    const conn = await openInMemoryConnection();
    try {
      await bootstrapNovelMaster(conn);
      // 版本保持 SCHEMA_BOOT_VERSION 不动，仅删掉两表——再 bootstrap 走
      // 快路径跳过全部 DDL，两表不应被重建（快路径「不建」的直证；
      // 真实库里该形态只会来自外部改动，快路径的合同就是信任 user_version）。
      await dropPackTables(conn);
      assert.equal(await readUserVersion(conn), SCHEMA_BOOT_VERSION);

      await bootstrapNovelMaster(conn);

      assert.equal(
        await tableExists(conn, "vfs_content_pack"),
        false,
        "快路径不应重跑 DDL 建 vfs_content_pack"
      );
      assert.equal(
        await tableExists(conn, "vfs_content_pack_member"),
        false,
        "快路径不应重跑 DDL 建 vfs_content_pack_member"
      );
      assert.equal(await readUserVersion(conn), SCHEMA_BOOT_VERSION);
    } finally {
      await conn.close();
    }
  });
});
