/**
 * T-RP1：repairRefCounts 批量化验证。
 *
 * 之前 {@link repairRefCounts} 内部对每条 revision 走一次 SELECT + 一次 UPDATE，
 * 200 条 revision 就要发 400 次 SQL。改成 {@link batchRepairRefCountFloor} 之后，
 * SELECT 和 UPDATE 各自按 500 分块，200 条只需 1 + 1 = 2 次。这里就守护这个上限。
 *
 * @module test/vfs/vfs-repair-ref-count-batch
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { openSqlCountingNovelMasterTestConnection } from "../helpers/sql-counting-connection.js";

import { repairRefCounts } from "@/domain/vfs/logic/revision-ref-count.js";
import { scopeKey } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";

type Ctx = Awaited<ReturnType<typeof openSqlCountingNovelMasterTestConnection>>;

let ctx: Ctx | undefined;

before(async () => {
  ctx = await openSqlCountingNovelMasterTestConnection();
});

after(async () => {
  if (ctx != null) {
    await ctx.conn.close();
    ctx = undefined;
  }
});

function getCtx(): Ctx {
  if (ctx == null) {
    throw new Error("Ctx 未初始化");
  }
  return ctx;
}

describe("T-RP1 repairRefCounts 批量化", () => {
  it("200 revision 只发 ≤ 2 条 SELECT + ≤ 2 条 UPDATE", async () => {
    const c = getCtx();
    const project = await c.projects.create("p-rp1");
    const vfs = c.projectVfs(project.id);
    const sk = scopeKey({ kind: "project", projectId: project.id });

    // 写 200 个文件，每个产生一条 revision，ref_count 由 live head +1 维护成 1。
    const N = 200;
    for (let i = 0; i < N; i++) {
      await vfs.write(`/docs/f${i}.md`, `body-${i}`);
    }

    //人为把所有 ref_count 压低到 0，制造需要修复的偏差。
    //直接走裸 SQL，避开 adjustRefCount 的存在性校验路径。
    await c.conn.execute(
      `UPDATE vfs_revision
       SET ref_count = 0
       WHERE entry_id IN (SELECT entry_id FROM vfs_entry WHERE scope_key = ?)`,
      [sk],
    );

    // 清空计数，下面的 repairRefCounts 才是真正被断言的部分。
    c.counter.clear();

    const revisionRepo = new SqliteVfsRevisionRepository(c.conn);
    const entryRepo = new SqliteVfsEntryRepository(c.conn);
    const checkpoints = new SqliteMessageCheckpointRepository(c.conn);

    const report = await repairRefCounts(
      revisionRepo,
      entryRepo,
      checkpoints,
      sk,
      "/",
      "",
    );

    // 200 条 revision 的 ref_count 都被 0 → 1 上调。
    assert.equal(
      report.rowsAdjusted,
      N,
      `应上调 ${N} 条，实际 ${report.rowsAdjusted}`,
    );
    assert.equal(report.rowsExamined, N);

    // 批量 SELECT（WHERE (entry_id, version) IN (...)）应 ≤ 2 次（200 一块就够，留余量）。
    const selectCount = c.counter.countBySubstring(
      "FROM vfs_revision WHERE (entry_id, version) IN",
    );
    assert.ok(
      selectCount <= 2,
      `ref_count 批量 SELECT 次数应 ≤ 2，实际 ${selectCount}`,
    );

    // 批量 UPDATE（SET ref_count = ? WHERE entry_id = ? AND version = ?）也应 ≤ 2 次。
    const updateCount = c.counter.countBySubstring(
      "UPDATE vfs_revision SET ref_count = ?",
    );
    assert.ok(
      updateCount <= 2,
      `ref_count 批量 UPDATE 次数应 ≤ 2，实际 ${updateCount}`,
    );

    // 修复后所有 ref_count 应回到 1（live head 维护的期望值）。
    const rows = await c.conn.query<{ ref_count: number; n: number }>(
      `SELECT ref_count, COUNT(*) AS n
       FROM vfs_revision r
       JOIN vfs_entry e ON e.entry_id = r.entry_id
       WHERE e.scope_key = ?
       GROUP BY ref_count`,
      [sk],
    );
    const total = rows.reduce((acc, r) => acc + Number(r.n), 0);
    assert.equal(total, N, `修复后仍应有 ${N} 条 revision`);
    for (const r of rows) {
      assert.equal(
        Number(r.ref_count),
        1,
        `修复后 ref_count 应为 1，实际存在 ref_count=${r.ref_count} 的行`,
      );
    }
  });

  it("已经是正确 ref_count 的 revision 不发 UPDATE（只增不减语义）", async () => {
    const c = getCtx();
    const project = await c.projects.create("p-rp1-noop");
    const vfs = c.projectVfs(project.id);
    const sk = scopeKey({ kind: "project", projectId: project.id });

    // 写 50 个文件，ref_count 已经正确（=1）。
    const N = 50;
    for (let i = 0; i < N; i++) {
      await vfs.write(`/noop/f${i}.md`, `noop-${i}`);
    }

    c.counter.clear();

    const revisionRepo = new SqliteVfsRevisionRepository(c.conn);
    const entryRepo = new SqliteVfsEntryRepository(c.conn);
    const checkpoints = new SqliteMessageCheckpointRepository(c.conn);

    const report = await repairRefCounts(
      revisionRepo,
      entryRepo,
      checkpoints,
      sk,
      "/",
      "",
    );

    // 没有偏差，一条都不该上调。
    assert.equal(report.rowsAdjusted, 0, `不应有上调，实际 ${report.rowsAdjusted}`);

    // SELECT 仍然要发（要知道当前 ref_count 才能判断有没有偏差）。
    const selectCount = c.counter.countBySubstring(
      "FROM vfs_revision WHERE (entry_id, version) IN",
    );
    assert.ok(selectCount >= 1, "至少应发一次批量 SELECT");

    // 但 UPDATE 不该发——current >= expected 的全被内存 diff 滤掉。
    const updateCount = c.counter.countBySubstring(
      "UPDATE vfs_revision SET ref_count = ?",
    );
    assert.equal(
      updateCount,
      0,
      `不应发任何 UPDATE，实际 ${updateCount}`,
    );
  });
});
