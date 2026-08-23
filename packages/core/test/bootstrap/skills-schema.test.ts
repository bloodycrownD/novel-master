/**
 * skill_disabled_rule 建表与存量库升级路径（T-SK3）。
 *
 * - 空库 bootstrap 后表与索引存在。
 * - 存量库（schema boot version 5、无 skill_disabled_rule）bootstrap 后
 *   幂等补建表并升 version；重复 bootstrap 不报错、表结构不重复。
 * - v6 撞车库（main 侧 v1.4.29 的 v6 与 skills 分支的 v6 内容不同）：重跑 DDL 补齐。
 *
 * @module test/bootstrap/skills-schema
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapNovelMaster, open } from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";

async function openMemory() {
  registerBetterSqlite3Driver();
  return open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
}

async function tableExists(
  conn: Awaited<ReturnType<typeof openMemory>>,
  name: string,
): Promise<boolean> {
  const rows = await conn.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${name}'`,
  );
  return rows.length === 1;
}

async function indexExists(
  conn: Awaited<ReturnType<typeof openMemory>>,
  name: string,
): Promise<boolean> {
  const rows = await conn.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name = '${name}'`,
  );
  return rows.length === 1;
}

describe("skill_disabled_rule 建表（T-SK3）", () => {
  it("空库 bootstrap 后 skill_disabled_rule 表与索引存在", async () => {
    const conn = await openMemory();
    await bootstrapNovelMaster(conn);

    assert.equal(await tableExists(conn, "skill_disabled_rule"), true);
    assert.equal(await indexExists(conn, "idx_skill_disabled_scope"), true);

    await conn.close();
  });

  it("v6 撞车库（被 main 侧 v1.4.29 的 v6 迁移过、无 skill_disabled_rule）重跑 DDL 补齐", async () => {
    const conn = await openMemory();
    // v6 版本号曾在两条分支各自使用：main v1.4.29 与 skills 分支各自 +1。
    // 被前者迁移过的库 user_version=6 但没有技能表——必须靠 v7 重跑全量 DDL 补建。
    await conn.execute("PRAGMA user_version = 6");
    assert.equal(await tableExists(conn, "skill_disabled_rule"), false);

    await bootstrapNovelMaster(conn);

    assert.equal(await tableExists(conn, "skill_disabled_rule"), true, "v6 撞车库应补建技能表");
    assert.equal(await indexExists(conn, "idx_skill_disabled_scope"), true);
    const versionRows = await conn.query<{ user_version: number }>(
      "PRAGMA user_version",
    );
    assert.equal(Number(versionRows[0]!.user_version), 8, "boot version 应升到 8");

    await conn.close();
  });

  it("存量库（boot version 5）升级：幂等补建表并升级，重复 bootstrap 安全", async () => {
    const conn = await openMemory();
    // 模拟 v5 存量库：版本号停在 5，且没有 skill_disabled_rule 表
    await conn.execute("PRAGMA user_version = 5");
    assert.equal(await tableExists(conn, "skill_disabled_rule"), false);

    await bootstrapNovelMaster(conn);

    assert.equal(await tableExists(conn, "skill_disabled_rule"), true, "升级路径应补建表");
    assert.equal(await indexExists(conn, "idx_skill_disabled_scope"), true);
    const versionRows = await conn.query<{ user_version: number }>(
      "PRAGMA user_version",
    );
    assert.equal(Number(versionRows[0]!.user_version), 8, "boot version 应升到 8");

    // 复合主键形态：重复 (scope_key, skill_name) 插入应被拒绝
    await conn.execute(
      `INSERT INTO skill_disabled_rule (scope_key, skill_name) VALUES ('project:p1', 'foo')`,
    );
    await assert.rejects(
      () =>
        conn.execute(
          `INSERT INTO skill_disabled_rule (scope_key, skill_name) VALUES ('project:p1', 'foo')`,
        ),
      /UNIQUE constraint failed/,
    );
    // 同名不同域互不冲突
    await conn.execute(
      `INSERT INTO skill_disabled_rule (scope_key, skill_name) VALUES ('project:p2', 'foo')`,
    );

    // 再跑一遍 bootstrap（幂等）：表不重复、不报错
    await bootstrapNovelMaster(conn);
    assert.equal(await tableExists(conn, "skill_disabled_rule"), true);

    await conn.close();
  });
});
