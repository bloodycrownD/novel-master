/**
 * Message visibility (hidden field) tests.
 *
 * @module test/chat/message-visibility
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

/**
 * 包一层记录 SQL 的连接。
 *
 * RULE（N-4 第 5 条）：给读路径换实现必须换观测面——「返回对象的列集」与
 * 「实际发出的 SELECT 文本」是结构上稳定的观测面，不会因为读口内部换了实现
 * 就静默失效。
 */
function recordingConnection(inner: TdbcConnection): {
  conn: TdbcConnection;
  sqls: string[];
} {
  const sqls: string[] = [];
  const conn: TdbcConnection = {
    execute: (sql, parameters) => {
      sqls.push(sql.trim());
      return inner.execute(sql, parameters);
    },
    query: (sql, parameters) => {
      sqls.push(sql.trim());
      return inner.query(sql, parameters);
    },
    batch: (sql, parametersList) => {
      sqls.push(sql.trim());
      return inner.batch(sql, parametersList);
    },
    transaction: (fn) => inner.transaction(fn),
    close: () => inner.close(),
  };
  return { conn, sqls };
}

describe("Message visibility", () => {
  it("hides and shows a single message", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S");
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("msg1"));

    await ctx.messages.hide(m1.id);
    const hidden = await ctx.messages.get(m1.id);
    assert.equal(hidden.hidden, true);

    await ctx.messages.show(m1.id);
    const shown = await ctx.messages.get(m1.id);
    assert.equal(shown.hidden, false);
  });

  it("hides a range of messages by seq", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S");
    await ctx.messages.append(session.id, "user", textBlocks("1"));
    await ctx.messages.append(session.id, "assistant", textBlocks("2"));
    await ctx.messages.append(session.id, "user", textBlocks("3"));
    await ctx.messages.append(session.id, "assistant", textBlocks("4"));

    const count = await ctx.messages.hideRange(session.id, 2, 3);
    assert.equal(count, 2);

    const list = await ctx.messages.listBySession(session.id);
    assert.equal(list[0]!.hidden, false); // seq 1
    assert.equal(list[1]!.hidden, true); // seq 2
    assert.equal(list[2]!.hidden, true); // seq 3
    assert.equal(list[3]!.hidden, false); // seq 4
  });

  it("listBySession includeHidden:false 在 SQL 层只回可见消息（chip 读口口径）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S");
    await ctx.messages.append(session.id, "user", textBlocks("visible-1"));
    const m2 = await ctx.messages.append(session.id, "assistant", textBlocks("hidden-1"));
    await ctx.messages.append(session.id, "user", textBlocks("visible-2"));
    await ctx.messages.hide(m2.id);

    const visibleOnly = await ctx.messages.listBySession(session.id, {
      includeHidden: false,
    });
    assert.deepEqual(
      visibleOnly.map((m) => m.hidden),
      [false, false],
      "隐藏行不出现在结果里"
    );
    assert.equal(visibleOnly.length, 2);

    // 默认口径不变：含 hidden 全量（回滚锚定等既有消费方）。
    const all = await ctx.messages.listBySession(session.id);
    assert.equal(all.length, 3);
    assert.equal(all[1]!.hidden, true);
  });

  it("listMessageHeadersBySession：头投影含 hidden、按 seq 升序、字段齐（不解压正文）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S");
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("h1"));
    await ctx.messages.append(session.id, "assistant", textBlocks("h2"));
    const m3 = await ctx.messages.append(session.id, "user", textBlocks("h3"));
    await ctx.messages.hide(m3.id);

    const headers = await ctx.messages.listMessageHeadersBySession(session.id);
    assert.equal(headers.length, 3);
    assert.deepEqual(
      headers.map((h) => [h.seq, h.role, h.hidden]),
      [
        [1, "user", false],
        [2, "assistant", false],
        [3, "user", true],
      ]
    );
    assert.equal(headers[0]!.id, m1.id);
    assert.equal(headers[0]!.sessionId, session.id);
    assert.ok(headers[0]!.createdAtMs > 0);
  });

  it("listBySessionOffset：头投影列集恰为 6 列、正文零解析、offset 语义不变", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S");
    await ctx.messages.append(session.id, "user", textBlocks("o1"));
    await ctx.messages.append(session.id, "assistant", textBlocks("o2"));
    const m3 = await ctx.messages.append(session.id, "user", textBlocks("o3"));
    await ctx.messages.hide(m3.id);

    const { conn, sqls } = recordingConnection(ctx.conn);
    const repo = new SqliteMessageRepository(conn);

    // G1 列集（有牙）：旧实现返回 21 键的整条 ChatMessage。
    const rows = await repo.listBySessionOffset(session.id, 1);
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.keys(rows[0]!).sort(), [
      "createdAtMs",
      "hidden",
      "id",
      "role",
      "seq",
      "sessionId",
    ]);
    assert.equal(rows[0]!.seq, 2);
    assert.equal(rows[1]!.seq, 3);
    assert.equal(rows[1]!.hidden, true);

    // G3 正文零解析：实际发出的 SELECT 不含任何正文字节列。
    const selects = sqls.filter((s) => s.startsWith("SELECT"));
    assert.equal(selects.length, 1, "应当只发一条查询");
    assert.ok(!selects[0]!.includes("content_json"), "不得选 content_json");
    assert.ok(!selects[0]!.includes("content_blob"), "不得选 content_blob");
    assert.ok(!selects[0]!.includes("raw_json"), "不得选 raw_json");
    assert.ok(!selects[0]!.includes("attachments_json"), "不得选 attachments_json");

    // G2 offset 语义：0/1/99/负数 ⇒ 3/2/0/3，按 seq 升序。
    assert.equal((await repo.listBySessionOffset(session.id, 0)).length, 3);
    assert.equal((await repo.listBySessionOffset(session.id, 1)).length, 2);
    assert.equal((await repo.listBySessionOffset(session.id, 99)).length, 0);
    const negative = await repo.listBySessionOffset(session.id, -5);
    assert.equal(negative.length, 3);
    assert.deepEqual(
      negative.map((r) => r.seq),
      [1, 2, 3]
    );
  });

  it("listBySessionTailOfRole：role 过滤在子查询内、limit 只数该 role、外层升序", async () => {
    // cr1-c1 P2-3：这条读口的真实 SQL 此前从未被任何用例打到（测试里全是桩）。
    // 观测面照本文件既有的 recordingConnection 形态——按「实际发出的 SELECT
    // 文本 + 真库返回行」两向钉，避免改 SQL 时悄悄改坏结构。
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S");
    // seq1 user / seq2 assistant / seq3-5 user / seq6-8 assistant
    await ctx.messages.append(session.id, "user", textBlocks("u1"));
    await ctx.messages.append(session.id, "assistant", textBlocks("a1"));
    for (let i = 0; i < 3; i++) {
      await ctx.messages.append(session.id, "user", textBlocks(`u${i + 2}`));
    }
    for (let i = 0; i < 3; i++) {
      await ctx.messages.append(session.id, "assistant", textBlocks(`a${i + 2}`));
    }

    const { conn, sqls } = recordingConnection(ctx.conn);
    const repo = new SqliteMessageRepository(conn);

    // ① limit 只数该 role：assistant 共 4 条，limit 2 只取最近 2 条（seq 7、8）。
    const assistantTail = await repo.listBySessionTailOfRole(session.id, "assistant", 2);
    assert.deepEqual(
      assistantTail.map((m) => m.seq),
      [7, 8],
      "limit 只数 assistant：夹在中间的 user 不占配额"
    );

    // ② 外层升序：返回顺序是 seq ASC，不是子查询里的 seq DESC。
    const sql = sqls[0]!;
    assert.ok(/ORDER BY seq ASC/i.test(sql), "外层必须 ORDER BY seq ASC");
    assert.ok(/ORDER BY seq DESC/i.test(sql), "内层必须 ORDER BY seq DESC 取尾");
    // role 过滤在**子查询内**：谓词与 LIMIT 同处内层，外层只有 ORDER BY。
    const innerRole = sql.indexOf("role =");
    const innerLimit = sql.indexOf("LIMIT");
    const outerOrder = sql.lastIndexOf("ORDER BY seq ASC");
    assert.ok(innerRole > 0, "SQL 里必须有 role 谓词");
    assert.ok(innerLimit > innerRole, "role 谓词必须排在 LIMIT 之前（即在内层）");
    assert.ok(
      sql.slice(0, innerLimit).includes("session_id ="),
      "session_id 谓词同样在子查询内"
    );
    assert.ok(outerOrder > innerLimit, "外层升序排在子查询之后");
    assert.equal(
      sql.slice(outerOrder).replace(/ORDER BY seq ASC/i, "").trim(),
      "",
      "外层除 ORDER BY 外不得再有别的条件"
    );

    // ③ user 侧同样只数 user；另一会话一条都不混进来（session_id 谓词在内层）。
    const userTail = await repo.listBySessionTailOfRole(session.id, "user", 3);
    assert.deepEqual(
      userTail.map((m) => m.seq),
      [3, 4, 5],
      "user tail 取最近 3 条"
    );
    const other = await ctx.sessions.create(project.id, "S2");
    await ctx.messages.append(other.id, "assistant", textBlocks("other"));
    const leaked = await repo.listBySessionTailOfRole(session.id, "assistant", 10);
    assert.equal(
      leaked.some((m) => m.sessionId === other.id),
      false,
      "session_id 谓词在子查询内 ⇒ 不得混入别的会话"
    );

    // ④ 仍是全列读口（下游 extractLastAssistantText 要正文）。
    assert.ok(Object.keys(assistantTail[0]!).includes("content"), "返回整条消息");
  });

  it("shows a range of messages by seq", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S");
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    const m2 = await ctx.messages.append(session.id, "assistant", textBlocks("2"));

    await ctx.messages.hide(m1.id);
    await ctx.messages.hide(m2.id);

    const count = await ctx.messages.showRange(session.id, 1, 2);
    assert.equal(count, 2);

    const list = await ctx.messages.listBySession(session.id);
    assert.equal(list[0]!.hidden, false);
    assert.equal(list[1]!.hidden, false);
  });

  it("fork preserves hidden state", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S");
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    const m2 = await ctx.messages.append(session.id, "assistant", textBlocks("2"));

    await ctx.messages.hide(m1.id);

    const forked = await ctx.messages.fork(session.id, m2.id);
    const forkedMsgs = await ctx.messages.listBySession(forked.id);

    assert.equal(forkedMsgs.length, 2);
    assert.equal(forkedMsgs[0]!.hidden, true); // m1 was hidden
    assert.equal(forkedMsgs[1]!.hidden, false); // m2 was visible
  });

  it("session copy preserves hidden state", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S");
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    await ctx.messages.append(session.id, "assistant", textBlocks("2"));

    await ctx.messages.hide(m1.id);

    const copy = await ctx.sessions.copy(session.id);
    const copyMsgs = await ctx.messages.listBySession(copy.id);

    assert.equal(copyMsgs.length, 2);
    assert.equal(copyMsgs[0]!.hidden, true); // m1 was hidden
    assert.equal(copyMsgs[1]!.hidden, false); // m2 was visible
  });

  it("hideRange returns 0 when fromSeq > toSeq", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S");
    await ctx.messages.append(session.id, "user", textBlocks("1"));

    const count = await ctx.messages.hideRange(session.id, 5, 3);
    assert.equal(count, 0);
  });

  it("hideRange only affects existing messages", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S");
    await ctx.messages.append(session.id, "user", textBlocks("1"));
    await ctx.messages.append(session.id, "assistant", textBlocks("2"));

    const count = await ctx.messages.hideRange(session.id, 1, 10);
    assert.equal(count, 2); // Only 2 messages exist
  });

  it("hideRange returns 0 when hiding already hidden messages", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S");
    await ctx.messages.append(session.id, "user", textBlocks("1"));
    await ctx.messages.append(session.id, "assistant", textBlocks("2"));

    const first = await ctx.messages.hideRange(session.id, 1, 2);
    assert.equal(first, 2);

    const second = await ctx.messages.hideRange(session.id, 1, 2);
    assert.equal(second, 0);
  });

  it("new messages are visible by default", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S");
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("msg1"));

    assert.equal(m1.hidden, false);
  });
});
