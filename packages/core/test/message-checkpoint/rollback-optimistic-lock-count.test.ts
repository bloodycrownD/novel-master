/**
 * T-RB1：rollback 乐观锁用 countBySession（→ Step 6 / 发现 10a）。
 *
 * 改造前 message-rollback.service 事务内的乐观锁对比用 listBySession 拉全量消息
 * 只为取 length，1000 条消息 = 拉 1000 行。改成 countBySession（COUNT(*) 返回 1 行）后，
 * 事务内乐观锁那步不再发全量 SELECT。
 *
 * 断言口径（rollback-large-jank Step 2 更新）：plan 拉取收窄为 seq >= 触发消息
 * （含），计数快照也改走 COUNT(*)——全流程 COUNT(*) chat_message 出现 2 次
 * （plan 计数快照 + 事务内乐观锁），无 seq 限定的全量 listBySession 归零，
 * 收窄拉取（AND seq >= ?）恰 2 次（plan 收窄 1 次 + truncate-tail 的 read
 * 引用对账拉取 1 次——read-tool-result-ref Step 3 起 tail 正文收集 refs 需要，
 * 同样按 seq 收窄，非全量）。
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
    // 乐观锁/计数快照的 countBySession：SELECT COUNT(*) ... FROM chat_message WHERE session_id = ?
    const countSelects = all.filter(
      (r) =>
        norm(r.sql).includes("select count(*)") &&
        norm(r.sql).includes("chat_message"),
    );
    // 全量 listBySession 的特征（收紧版，rollback-large-jank Step 2 后）：
    // WHERE session_id = ? 后直接 ORDER BY seq（无 seq 限定）。
    const fullListSelects = all.filter((r) =>
      norm(r.sql).includes("where session_id = ? order by seq"),
    );
    // plan 收窄拉取特征：seq >= 触发消息（含下界）。
    const fromSeqSelects = all.filter((r) =>
      norm(r.sql).includes("and seq >= ?"),
    );

    if (
      countSelects.length !== 2 ||
      fullListSelects.length !== 0 ||
      fromSeqSelects.length !== 1
    ) {
      for (const r of all) {
        if (norm(r.sql).includes("chat_message")) {
          console.log(`[${r.via}] ${r.kind}: ${r.sql.slice(0, 160)}`);
        }
      }
    }

    assert.equal(
      countSelects.length,
      2,
      `COUNT(*) chat_message 应出现 2 次（plan 计数快照 + 事务内乐观锁），实际 ${countSelects.length}`,
    );
    // 发现 10a 改造后乐观锁改 COUNT、全量 list 只剩 plan 1 次；rollback-large-jank
    // Step 2 再把 plan 拉取收窄为 seq >= 触发消息（含）——全量 list 归零。
    // read-tool-result-ref Step 3 起 truncate-tail 需拉 tail 正文做 read 引用 −1
    // 对账（同样 seq 收窄），收窄拉取变 2 次；全量口径（fullListSelects）不变。
    assert.equal(
      fullListSelects.length,
      0,
      `无 seq 限定的全量 listBySession 不应再出现，实际 ${fullListSelects.length}`,
    );
    assert.equal(
      fromSeqSelects.length,
      2,
      `收窄拉取（seq >=）应恰 2 次（plan 收窄 + truncate-tail read 引用对账），实际 ${fromSeqSelects.length}`,
    );
  });
});
