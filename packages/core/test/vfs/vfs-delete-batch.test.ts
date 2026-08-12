/**
 * T-DEL1：vfs.delete 递归删大目录的 SQL 次数回归（→ Step 4 / 发现 8）。
 *
 * 改造前 `appendDeletedRevisionsForSubtree` 对每个子文件走 `scanContents` +
 * 逐条 `findByPath` + `adjustRef` + `append` + `adjustRef`，删 100 文件要发
 * ~302 条业务 SQL。改成 `listFileHeadsUnderPrefix` + `batchAdjustRefCount` +
 * `batchAppendWithRefCount` 后应压到个位数。这里给一个 ≤ 20 的保守上限断言，
 * 同时校验墓碑数量、ref_count、可见性这些正确性不变量。
 *
 * @module test/vfs/vfs-delete-batch
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { openSqlCountingNovelMasterTestConnection } from "../helpers/sql-counting-connection.js";
import type { NovelMasterTestContext } from "../helpers/novel-master.js";
import { testIsolationSuffix } from "../helpers/novel-master-fixture.js";

type CountingCtx = NovelMasterTestContext & {
  readonly counter: import("../helpers/sql-counting-connection.js").SqlCounter;
};

let ctx: CountingCtx | undefined;

before(async () => {
  ctx = (await openSqlCountingNovelMasterTestConnection()) as CountingCtx;
});
after(async () => {
  if (ctx != null) {
    await ctx.conn.close();
    ctx = undefined;
  }
});

function getCtx(): CountingCtx {
  if (ctx == null) {
    throw new Error("before hook did not run");
  }
  return ctx;
}

const FILE_COUNT = 100;
// 改造前 ~302 条；改造后个位数。留宽松余量，避免触发器/分块边界带来的微小波动误伤。
const SQL_UPPER_BOUND = 20;

describe("T-DEL1 vfs.delete 递归删除批量化", () => {
  it(`删 ${FILE_COUNT} 文件目录：SQL 总数 ≤ ${SQL_UPPER_BOUND}`, async () => {
    const c = getCtx();
    const project = await c.projects.create(`P-${testIsolationSuffix()}`);
    const vfs = c.projectVfs(project.id);

    // 准备阶段：建目录 + 写 100 个文件（这部分 SQL 不计入统计）。
    await vfs.mkdir("/tree");
    for (let i = 0; i < FILE_COUNT; i++) {
      await vfs.write(`/tree/f${i}.md`, `body-${i}`);
    }

    // 清掉准备阶段的 SQL，只统计 delete 这一段。
    c.counter.clear();

    await vfs.delete("/tree", { recursive: true });

    const total = c.counter.count();
    // 调试失败时把语句打出来，方便定位是哪一步又退化成逐条。
    if (total > SQL_UPPER_BOUND) {
      for (const r of c.counter.all()) {
        console.log(`[${r.via}] ${r.kind}: ${r.sql.slice(0, 120)}`);
      }
    }
    assert.ok(
      total <= SQL_UPPER_BOUND,
      `vfs.delete 发出 ${total} 条 SQL，超过上限 ${SQL_UPPER_BOUND}（改造前 ~302）`,
    );
  });

  it("正确性：每个子文件都留下 deleted 墓碑且旧 active ref_count 归零", async () => {
    const c = getCtx();
    const project = await c.projects.create(`P-${testIsolationSuffix()}`);
    const vfs = c.projectVfs(project.id);

    await vfs.mkdir("/tree2");
    for (let i = 0; i < FILE_COUNT; i++) {
      await vfs.write(`/tree2/g${i}.md`, `body-${i}`);
    }
    await vfs.delete("/tree2", { recursive: true });

    // 墓碑数量 = 文件数（deleted revision，ref_count=1）。
    const tombstones = await c.conn.query<{ c: number }>(
      `SELECT COUNT(*) AS c FROM vfs_revision WHERE status = 'deleted'`,
    );
    // 项目 scope 下旧 active 行的 ref_count 应该都被 -1 到 0（墓碑 +1 在 deleted 行上）。
    const staleActive = await c.conn.query<{ c: number }>(
      `SELECT COUNT(*) AS c
       FROM vfs_revision r
       JOIN vfs_entry e ON e.entry_id = r.entry_id
       WHERE e.scope_key = ? AND e.path LIKE '/tree2/%'
         AND r.status = 'active' AND r.ref_count > 0`,
      [project.id],
    );

    assert.ok(
      tombstones[0].c >= FILE_COUNT,
      `deleted 墓碑应至少 ${FILE_COUNT} 条，实际 ${tombstones[0].c}`,
    );
    assert.equal(
      staleActive[0].c,
      0,
      "旧 active revision 的 ref_count 应全部归零",
    );
  });

  it("可见性：删除后子文件不可读", async () => {
    const c = getCtx();
    const project = await c.projects.create(`P-${testIsolationSuffix()}`);
    const vfs = c.projectVfs(project.id);

    await vfs.mkdir("/tree3");
    await vfs.write("/tree3/a.md", "A");
    await vfs.write("/tree3/b.md", "B");
    await vfs.delete("/tree3", { recursive: true });

    await assert.rejects(() => vfs.read("/tree3/a.md"));
    await assert.rejects(() => vfs.read("/tree3/b.md"));
  });
});
