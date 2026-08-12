/**
 * T-RB1：rollback 乐观锁用 countBySession（→ Step 6 / 发现 10a）。
 *
 * 改造前 message-rollback.service 事务内的乐观锁对比用 listBySession 拉全量消息
 * 只为取 length，1000 条消息 = 拉 1000 行。改成 countBySession（COUNT(*) 返回 1 行）后，
 * 事务内乐观锁那步不再发全量 SELECT。
 *
 * 断言口径：rollback 整体流程里，COUNT(*) chat_message 出现 1 次（事务内乐观锁），
 * 全量 listBySession（FROM chat_message ... ORDER BY seq）只剩 plan 阶段那 1 次——
 * 改造前乐观锁也走全量 list，所以全量 list 会出现 2 次（plan + 乐观锁）。
 *
 * @module test/message-checkpoint/rollback-optimistic-lock-count
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { textBlocks } from "@novel-master/core/chat";
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

const MSG_COUNT = 1000;

/** 把 SQL 文本归一化（小写 + 压空白），方便用 includes 子串匹配业务语句。 */
function norm(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, " ").trim();
}

describe("T-RB1 rollback 乐观锁用 countBySession", () => {
  it(`造 ${MSG_COUNT} 条消息 rollback：乐观锁发 COUNT(*) 而非全量 listBySession`, async () => {
    const c = getCtx();
    const project = await c.projects.create(`P-rb1-${testIsolationSuffix()}`);
    const session = await c.sessions.create(project.id);

    let lastId = "";
    for (let i = 0; i < MSG_COUNT; i++) {
      const m = await c.messages.append(
        session.id,
        i % 2 === 0 ? "user" : "assistant",
        textBlocks(`m${i}`),
      );
      lastId = m.id;
    }

    c.counter.clear();

    // skipVfsReconcile：这个会话没有 VFS 文件，跳过 reconcile 让 rollback 直接走到
    // 乐观锁 + 截断，聚焦验证乐观锁那一步的 SQL 形态。
    await c.sessionFs.rollbackToMessage(session.id, project.id, lastId, {
      skipVfsReconcile: true,
    });

    const all = c.counter.all();
    // 乐观锁的 countBySession：SELECT COUNT(*) ... FROM chat_message WHERE session_id = ?
    const countSelects = all.filter(
      (r) =>
        norm(r.sql).includes("select count(*)") &&
        norm(r.sql).includes("chat_message"),
    );
    // 全量 listBySession 的特征：FROM chat_message WHERE session_id ... ORDER BY seq。
    const fullListSelects = all.filter(
      (r) =>
        norm(r.sql).includes("from chat_message") &&
        norm(r.sql).includes("order by seq"),
    );

    if (countSelects.length !== 1 || fullListSelects.length !== 1) {
      for (const r of all) {
        if (norm(r.sql).includes("chat_message")) {
          console.log(`[${r.via}] ${r.kind}: ${r.sql.slice(0, 160)}`);
        }
      }
    }

    assert.equal(
      countSelects.length,
      1,
      `乐观锁应发 1 条 COUNT(*) chat_message，实际 ${countSelects.length}`,
    );
    // 改造前乐观锁也走全量 listBySession → 全量 list 出现 2 次（plan + 乐观锁）；
    // 改造后乐观锁改 COUNT，全量 list 只剩 plan 阶段这 1 次。
    assert.equal(
      fullListSelects.length,
      1,
      `全量 listBySession 只应剩 plan 阶段 1 次，实际 ${fullListSelects.length}（改造前 2 次）`,
    );
  });
});
