/**
 * T-WP1：workplace.copyScope 批量 upsert（修复发现 5）。
 *
 * 原来 copyScope 对 dirs / files 各一个 for 循环逐条 upsert，每条一条 INSERT … ON CONFLICT，
 * 规则数十几到上百时 round-trip = 规则数。改成收集两组规则后各调一次 batchUpsert*，
 * 整体 SQL 语句数收敛到：DELETE = 2（前置 deleteScope 的 dirs + files）、INSERT = 2（两个 batch）。
 *
 * 计数口径（SPEC P2-NEW-A）：统计 copyScope 整体执行的 SQL 语句数，含前置 deleteScope。
 *
 * @module test/workplace/workplace-copy-scope-batch
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  bootstrapNovelMaster,
  open,
  type TdbcConnection,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";

import { SqliteWorkplaceRepository } from "@/domain/workplace/repositories/impl/sqlite-workplace.repository.js";
import type {
  WorkplaceDirRule,
  WorkplaceFileRule,
} from "@/domain/workplace/model/workplace-types.js";

import {
  CountingTdbcConnection,
  SqlCounter,
} from "../helpers/sql-counting-connection.js";

interface CountedCtx {
  readonly conn: TdbcConnection;
  readonly counter: SqlCounter;
  readonly repo: SqliteWorkplaceRepository;
}

async function openCountedCtx(): Promise<CountedCtx> {
  registerBetterSqlite3Driver();
  const rawConn = await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
  const counter = new SqlCounter();
  const conn: TdbcConnection = new CountingTdbcConnection(rawConn, counter);
  await bootstrapNovelMaster(conn);
  return { conn, counter, repo: new SqliteWorkplaceRepository(conn) };
}

let ctx: CountedCtx | undefined;

before(async () => {
  ctx = await openCountedCtx();
});

after(async () => {
  if (ctx != null) {
    await ctx.conn.close();
    ctx = undefined;
  }
});

function getCtx(): CountedCtx {
  if (ctx == null) {
    throw new Error("CountedCtx 未初始化");
  }
  return ctx;
}

const FROM_SCOPE = "project:copy-from";
const TO_SCOPE = "project:copy-to";

describe("T-WP1 copyScope 批量 upsert", () => {
  it("50 dir rule + 50 file rule：DELETE ≤ 2 + INSERT ≤ 2", async () => {
    const c = getCtx();

    // 在源 scope 造 50 条 dir rule + 50 条 file rule。
    const N = 50;
    const dirRules: WorkplaceDirRule[] = [];
    const fileRules: WorkplaceFileRule[] = [];
    for (let i = 0; i < N; i++) {
      dirRules.push({
        scopeKey: FROM_SCOPE,
        logicalPath: `/dir-${i}`,
        ruleEnabled: i % 2 === 0,
        sortField: "name",
        sortOrder: "asc",
        headCount: i,
        tailCount: N - i,
        fillPolicy: "header",
      });
      fileRules.push({
        scopeKey: FROM_SCOPE,
        logicalPath: `/dir-${i}/file-${i}.md`,
        inclusionMode: i % 3 === 0 ? "show" : i % 3 === 1 ? "hide" : "auto",
      });
    }
    // 用单条 upsert 播种源数据（不纳入被测计数窗口）。
    for (const r of dirRules) {
      await c.repo.upsertDirRule(r);
    }
    for (const r of fileRules) {
      await c.repo.upsertFileRule(r);
    }

    // 计数窗口：只统计 copyScope 本身发出的 SQL（含前置 deleteScope）。
    c.counter.clear();
    await c.repo.copyScope(FROM_SCOPE, TO_SCOPE, (p) => `/copy${p}`);

    const dirDeletes = c.counter.countBySubstring(
      "DELETE FROM workplace_dir_rule",
    );
    const fileDeletes = c.counter.countBySubstring(
      "DELETE FROM workplace_file_rule",
    );
    const dirInserts = c.counter.countBySubstring(
      "INSERT INTO workplace_dir_rule",
    );
    const fileInserts = c.counter.countBySubstring(
      "INSERT INTO workplace_file_rule",
    );

    const totalDeletes = dirDeletes + fileDeletes;
    const totalInserts = dirInserts + fileInserts;

    assert.ok(
      totalDeletes <= 2,
      `DELETE 次数应 ≤ 2，实际 ${totalDeletes}（dir ${dirDeletes} + file ${fileDeletes}）`,
    );
    assert.ok(
      totalInserts <= 2,
      `INSERT 次数应 ≤ 2，实际 ${totalInserts}（dir ${dirInserts} + file ${fileInserts}）`,
    );

    // 正确性：目标 scope 应有完整的 50 + 50 条，路径被 /copy 前缀映射。
    const toDirs = await c.repo.listDirRules(TO_SCOPE);
    const toFiles = await c.repo.listFileRules(TO_SCOPE);
    assert.equal(toDirs.length, N, "目标 scope dir rule 数应为 50");
    assert.equal(toFiles.length, N, "目标 scope file rule 数应为 50");
    assert.ok(
      toDirs.every((d) => d.logicalPath.startsWith("/copy/dir-")),
      "目标 dir rule 路径应被 mapLogicalPath 映射",
    );
    assert.ok(
      toFiles.every((f) => f.logicalPath.startsWith("/copy/dir-")),
      "目标 file rule 路径应被 mapLogicalPath 映射",
    );

    // 源 scope 不应被 copyScope 改动。
    const fromDirs = await c.repo.listDirRules(FROM_SCOPE);
    assert.equal(fromDirs.length, N, "源 scope dir rule 不应被 copyScope 改动");
  });

  it("源 scope 为空时 copyScope 不发 INSERT，仅 deleteScope 的 DELETE", async () => {
    const c = getCtx();
    const emptyFrom = "project:copy-empty-from";
    const emptyTo = "project:copy-empty-to";

    c.counter.clear();
    await c.repo.copyScope(emptyFrom, emptyTo, (p) => p);

    // 源为空 → batchUpsert* 走空数组 no-op，不发 INSERT。
    const dirInserts = c.counter.countBySubstring(
      "INSERT INTO workplace_dir_rule",
    );
    const fileInserts = c.counter.countBySubstring(
      "INSERT INTO workplace_file_rule",
    );
    assert.equal(dirInserts, 0, "源为空时不应发 dir rule INSERT");
    assert.equal(fileInserts, 0, "源为空时不应发 file rule INSERT");

    // deleteScope 仍会发两条 DELETE（目标 scope 为空时 changes=0，但 SQL 照发）。
    const totalDeletes =
      c.counter.countBySubstring("DELETE FROM workplace_dir_rule") +
      c.counter.countBySubstring("DELETE FROM workplace_file_rule");
    assert.equal(totalDeletes, 2, "deleteScope 仍应发 2 条 DELETE");
  });
});
