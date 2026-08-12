/**
 * T-FK2：fork/copy 消息写入批量化回归（→ Step 5 / 发现 9+12）。
 *
 * 改造前 `message.service.ts` 的 fork 和 `session.service.ts` 的 copy 对每条消息
 * 走一次 `r.messages.insert`，M 条消息 = M 次 INSERT。改成构造数组后一次
 * `batchInsert`（底层 `conn.batch`）后，应压成 1 条 INSERT。
 *
 * 这里给 fork 40 条消息和 copy 40 条消息各一个用例，断言 `INSERT INTO chat_message`
 * 只出现 1 次（且走 batch 路径），并顺手校验目标会话消息数正确——证明批量化没破坏正确性。
 *
 * @module test/chat/fork-copy-batch-insert
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

const MSG_COUNT = 40;

/** 把 SQL 文本归一化（小写 + 压空白），方便用 includes 子串匹配业务语句。 */
function norm(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, " ").trim();
}

describe("T-FK2 fork/copy 消息批量化", () => {
  it(`fork ${MSG_COUNT} 条消息：INSERT INTO chat_message 只发 1 条（batch）`, async () => {
    const c = getCtx();
    const project = await c.projects.create(`P-fk2-${testIsolationSuffix()}`);
    const session = await c.sessions.create(project.id);

    // 准备阶段：append 40 条消息。这段 SQL 不计入统计。
    let lastId = "";
    for (let i = 0; i < MSG_COUNT; i++) {
      const m = await c.messages.append(
        session.id,
        i % 2 === 0 ? "user" : "assistant",
        textBlocks(`m${i}`),
      );
      lastId = m.id;
    }

    // 清掉准备阶段的 SQL，只统计 fork 这一段。
    c.counter.clear();

    const forked = await c.messages.fork(session.id, lastId);

    // fork 内部除了消息 INSERT，还有 session insert / VFS copy / checkpoint seed 等，
    // 但只有 batchInsert 这一条会碰 chat_message 表——找出所有 chat_message 的 INSERT。
    const chatInserts = c.counter
      .all()
      .filter((r) => norm(r.sql).includes("insert into chat_message"));

    if (chatInserts.length !== 1) {
      for (const r of c.counter.all()) {
        console.log(`[${r.via}] ${r.kind}: ${r.sql.slice(0, 140)}`);
      }
    }
    assert.equal(
      chatInserts.length,
      1,
      `fork 应只发 1 条 chat_message INSERT，实际 ${chatInserts.length}（改造前 ${MSG_COUNT}）`,
    );
    assert.equal(
      chatInserts[0]!.via,
      "batch",
      "chat_message INSERT 应走 batch 路径（batchInsert）",
    );

    // 正确性：fork 出的会话消息数 = 源会话。
    const forkedMsgs = await c.messages.listBySession(forked.id);
    assert.equal(forkedMsgs.length, MSG_COUNT);
  });

  it(`copy ${MSG_COUNT} 条消息：INSERT INTO chat_message 只发 1 条（batch）`, async () => {
    const c = getCtx();
    const project = await c.projects.create(`P-fk2cp-${testIsolationSuffix()}`);
    const session = await c.sessions.create(project.id);

    for (let i = 0; i < MSG_COUNT; i++) {
      await c.messages.append(
        session.id,
        i % 2 === 0 ? "user" : "assistant",
        textBlocks(`c${i}`),
      );
    }

    c.counter.clear();

    const copied = await c.sessions.copy(session.id);

    const chatInserts = c.counter
      .all()
      .filter((r) => norm(r.sql).includes("insert into chat_message"));

    if (chatInserts.length !== 1) {
      for (const r of c.counter.all()) {
        console.log(`[${r.via}] ${r.kind}: ${r.sql.slice(0, 140)}`);
      }
    }
    assert.equal(
      chatInserts.length,
      1,
      `copy 应只发 1 条 chat_message INSERT，实际 ${chatInserts.length}（改造前 ${MSG_COUNT}）`,
    );
    assert.equal(
      chatInserts[0]!.via,
      "batch",
      "chat_message INSERT 应走 batch 路径（batchInsert）",
    );

    const copiedMsgs = await c.messages.listBySession(copied.id);
    assert.equal(copiedMsgs.length, MSG_COUNT);
  });
});
