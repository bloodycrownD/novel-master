/**
 * T-R4（rollback-large-jank Step 4）：全局孤儿 revision 清扫 deferred 化。
 *
 * - 回滚事务内不再发全局孤儿 DELETE（scoped 打扫保留在事务内）；
 * - `rollbackToMessage` resolve 先于清扫 SQL 执行（清扫体经微任务脱离
 *   调用方同步栈，fire-and-forget 不阻塞回滚结果与 UI 链）；
 * - 清扫进行中重复调度不重入（模块级 in-flight 去重——受控挂起连接下
 *   断言第二条调度被丢弃）；
 * - 孤儿行最终被清（排空微任务后孤儿归零）；
 * - 回滚后至清扫前的窗口内孤儿残留不影响回滚正确性。
 *
 * @module test/message-checkpoint/deferred-revision-orphan-gc
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { createMessageRollbackService } from "../../src/service/message-checkpoint/create-message-checkpoint-services.js";
import { scheduleDeferredRevisionOrphanGc } from "../../src/domain/message-checkpoint/logic/deferred-revision-orphan-gc.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import { openSqlCountingNovelMasterTestConnection } from "../helpers/sql-counting-connection.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 全局孤儿 DELETE 的 SQL 特征（deleteGlobalOrphans 专用形态）。 */
function isGlobalOrphanDelete(sql: string): boolean {
  const n = sql.toLowerCase();
  return (
    n.includes("delete from vfs_revision") &&
    n.includes("not in (select entry_id from vfs_entry)")
  );
}

/** 排空微任务与一轮宏任务（让 fire-and-forget 的清扫体跑完）。 */
async function drainMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("deferred 全局孤儿清扫（T-R4）", () => {
  it("T-R4a: 回滚事务内无全局孤儿 DELETE；resolve 先于清扫 SQL；孤儿最终被清", async () => {
    const ctx = await openSqlCountingNovelMasterTestConnection();
    const project = await ctx.projects.create(`P-tr4a-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("a"));
    const anchor = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "b" }],
    });
    await ctx.messages.append(session.id, "user", textBlocks("tail"));

    // 造一行孤儿 revision：entry_id 指向不存在的 entry、ref_count<=0
    //（content_hash 置 NULL 且 status=deleted，避开 INSERT 触发器与
    // active+NULL 的 CHECK 约束）。
    await ctx.conn.execute(
      `INSERT INTO vfs_revision (entry_id, version, status, mtime_ms, content_hash, ref_count)
       VALUES (999001, 1, 'deleted', 0, NULL, 0)`
    );

    ctx.counter.clear();
    const rollback = createMessageRollbackService(ctx.conn);
    const rollbackDone = rollback.rollbackToMessage(
      session.id,
      project.id,
      anchor.id,
      { skipVfsReconcile: true }
    );
    // 「resolve 先于清扫」的操作性断言：先排一个微任务观察点——rollback 的
    // resolve 链在清扫体（第二个微任务）之前。这里以「回滚 promise 完成、
    // 而孤儿 DELETE 计数为 0」直接锁定：resolve 时点清扫 SQL 尚未发出。
    await rollbackDone;
    assert.equal(
      ctx.counter.all().filter((r) => isGlobalOrphanDelete(r.sql)).length,
      0,
      "rollbackToMessage resolve 时全局孤儿 DELETE 不得已发出（fire-and-forget 须让位于回滚结果）"
    );

    // 排空后：孤儿清扫恰发一次，孤儿行被清掉。
    await drainMicrotasks();
    assert.equal(
      ctx.counter.all().filter((r) => isGlobalOrphanDelete(r.sql)).length,
      1,
      "回滚提交后应 fire-and-forget 调度恰一次全局孤儿清扫"
    );
    const orphans = await ctx.conn.query(
      `SELECT COUNT(*) AS n FROM vfs_revision WHERE entry_id NOT IN (SELECT entry_id FROM vfs_entry)`
    );
    assert.equal(Number(orphans[0]!.n), 0, "孤儿 revision 行最终应被清");

    // 回滚语义不受影响（rewind 保留锚点，tail 截断）。
    const left = await ctx.messages.listBySession(session.id);
    assert.equal(left.length, 2);
    assert.equal(left[1]!.id, anchor.id);
    await ctx.conn.close();
  });

  it("T-R4b: 清扫进行中重复调度不重入（in-flight 去重）；孤儿残留窗口不影响回滚正确性", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tr4b-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("a"));
    const anchor = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "b" }],
    });
    await ctx.messages.append(session.id, "user", textBlocks("tail"));

    // 受控连接：孤儿 DELETE 挂起在 gate 上，直到测试放行。
    const releases: Array<() => void> = [];
    let orphanDeleteCalls = 0;
    const gatedConn: TdbcConnection = Object.create(ctx.conn) as TdbcConnection;
    gatedConn.execute = (sql: string, parameters?: readonly unknown[]) => {
      if (isGlobalOrphanDelete(sql)) {
        orphanDeleteCalls += 1;
        return new Promise((resolve) => {
          releases.push(() => resolve({ changes: 0 }));
        }) as ReturnType<TdbcConnection["execute"]>;
      }
      return ctx.conn.execute(sql, parameters);
    };
    gatedConn.query = (sql, parameters) =>
      ctx.conn.query(sql, parameters) as ReturnType<TdbcConnection["query"]>;
    gatedConn.batch = (sql, parametersList) =>
      ctx.conn.batch(sql, parametersList) as ReturnType<TdbcConnection["batch"]>;
    gatedConn.transaction = (fn) =>
      ctx.conn.transaction(fn) as ReturnType<TdbcConnection["transaction"]>;

    // 窗口语义：孤儿残留时回滚照常正确（孤儿与本会话无关）。
    await ctx.conn.execute(
      `INSERT INTO vfs_revision (entry_id, version, status, mtime_ms, content_hash, ref_count)
       VALUES (999002, 1, 'deleted', 0, NULL, 0)`
    );

    // 第一次调度：清扫挂在 gate 上（进行中）。
    scheduleDeferredRevisionOrphanGc(gatedConn);
    await drainMicrotasks();
    assert.equal(orphanDeleteCalls, 1, "第一次调度应发出孤儿 DELETE");
    assert.equal(releases.length, 1);

    // 孤儿残留窗口内：回滚正常完成且语义正确。
    const rollback = createMessageRollbackService(ctx.conn);
    await rollback.rollbackToMessage(session.id, project.id, anchor.id, {
      skipVfsReconcile: true,
    });
    const left = await ctx.messages.listBySession(session.id);
    assert.equal(left.length, 2);
    assert.equal(left[1]!.id, anchor.id);

    // 清扫进行中重复调度：直接丢弃（不重入、不发第二条 DELETE）。
    scheduleDeferredRevisionOrphanGc(gatedConn);
    scheduleDeferredRevisionOrphanGc(gatedConn);
    await drainMicrotasks();
    assert.equal(
      orphanDeleteCalls,
      1,
      "in-flight 守卫下重复调度不得重入孤儿 DELETE"
    );

    // 放行第一次清扫后，守卫复位——新一轮调度可再次发出。
    releases[0]!();
    await drainMicrotasks();
    scheduleDeferredRevisionOrphanGc(gatedConn);
    await drainMicrotasks();
    assert.equal(orphanDeleteCalls, 2, "守卫复位后新调度应可再次发出");
    // 放行挂起的第二次 DELETE（gate 连接只挂起不真执行），随后以真连接
    // 调度一次收尾——验证孤儿行最终被真实清除。
    for (const release of releases.splice(1)) {
      release();
    }
    await drainMicrotasks();
    scheduleDeferredRevisionOrphanGc(ctx.conn);
    await drainMicrotasks();

    const orphans = await ctx.conn.query(
      `SELECT COUNT(*) AS n FROM vfs_revision WHERE entry_id NOT IN (SELECT entry_id FROM vfs_entry)`
    );
    assert.equal(Number(orphans[0]!.n), 0, "放行后孤儿最终被清");
  });
});
