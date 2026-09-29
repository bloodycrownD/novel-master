/**
 * tool_use_count 存量回填任务用例（metric-detail 弹窗读路径提速轮）。
 *
 * 口径：谓词 `role='assistant' AND tool_use_count IS NULL`，批 ≤100 行短
 * 事务，完成置 KKV 标记（nm-tool-use-count/backfillDone）。共享库上每个
 * 用例开头自管标记状态（清标记），与 message-content-compaction.test 的
 * 直查断言风格一致。
 *
 * @module test/infra/tool-use-count-backfill
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import {
  runToolUseCountBackfill,
  TOOL_USE_COUNT_KKV_KEY,
  TOOL_USE_COUNT_KKV_MODULE,
} from "../../src/infra/db-maintenance/index.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";
import type { MessageContent } from "../../src/domain/chat/model/message.js";

novelMasterTestFixture();

function conn(): TdbcConnection {
  return getNovelMasterTestContext().conn;
}

beforeEach(async () => {
  await conn().execute("DELETE FROM chat_message");
  await conn().execute("DELETE FROM kkv_entry WHERE module = ?", [
    TOOL_USE_COUNT_KKV_MODULE,
  ]);
});

async function newSession(): Promise<string> {
  const ctx = getNovelMasterTestContext();
  const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
  const session = await ctx.sessions.create(
    project.id,
    `S-${testIsolationSuffix()}`
  );
  return session.id;
}

/**
 * 手工 INSERT 一条 legacy 行（模拟 v18 前存量 / 直插 fixture）：
 * tool_use_count 落 NULL。content 明文进 content_json（读侧双形态兜底）。
 */
async function insertLegacyRow(
  sessionId: string,
  seq: number,
  role: "user" | "assistant",
  content: MessageContent,
  opts?: { corruptBlob?: boolean }
): Promise<string> {
  const id = randomUUID();
  if (opts?.corruptBlob) {
    // 坏行：encoding 声称 zlib 但字节不是 zlib 流（解压必抛）。
    await conn().execute(
      `INSERT INTO chat_message (
         id, session_id, seq, role, content_json, created_at_ms, hidden,
         content_encoding, content_blob
       ) VALUES (?, ?, ?, ?, '', ?, 0, 'zlib', ?)`,
      [id, sessionId, seq, role, Date.now(), Buffer.from([0x00, 0x01, 0xff])]
    );
    return id;
  }
  await conn().execute(
    `INSERT INTO chat_message (
       id, session_id, seq, role, content_json, created_at_ms, hidden
     ) VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [id, sessionId, seq, role, JSON.stringify(content), Date.now()]
  );
  return id;
}

function assistantToolContent(toolCount: number): MessageContent {
  const blocks = [{ type: "text", text: "call tools" }];
  for (let i = 0; i < toolCount; i++) {
    blocks.push({
      type: "tool_use",
      id: `tu-${i}`,
      name: "write",
      input: { path: "/a.md", content: "x" },
    });
  }
  return { blocks };
}

async function toolUseCountOf(id: string): Promise<number | null> {
  const rows = await conn().query<{ n: number | null }>(
    "SELECT tool_use_count AS n FROM chat_message WHERE id = ?",
    [id]
  );
  const v = rows[0]?.n;
  return v == null ? null : Number(v);
}

describe("tool_use_count 存量回填（tool-use-count-backfill）", () => {
  it("回填 NULL assistant 行并置完成标记；二轮零成本；user 行不回填", async () => {
    const sid = await newSession();
    const a1 = await insertLegacyRow(sid, 1, "assistant", assistantToolContent(2));
    const a2 = await insertLegacyRow(sid, 3, "assistant", assistantToolContent(0));
    // user 行带 tool_result 块：不在谓词内，永远不被回填（读侧不消费）。
    const u1 = await insertLegacyRow(sid, 2, "user", {
      blocks: [{ type: "tool_result", toolUseId: "tu-0", content: "ok" }],
    });

    const result = await runToolUseCountBackfill(conn());
    assert.equal(result.done, true);
    assert.equal(result.backfilledCount, 2);
    assert.equal(result.failedCount, 0);
    assert.equal(await toolUseCountOf(a1), 2);
    assert.equal(await toolUseCountOf(a2), 0);
    assert.equal(await toolUseCountOf(u1), null);

    // 二轮：标记已置，零成本返回（backfilledCount 0，marker 值原样）。
    const again = await runToolUseCountBackfill(conn());
    assert.equal(again.done, true);
    assert.equal(again.backfilledCount, 0);

    const marker = await conn().query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM kkv_entry WHERE module = ? AND key = ?",
      [TOOL_USE_COUNT_KKV_MODULE, TOOL_USE_COUNT_KKV_KEY]
    );
    assert.equal(Number(marker[0]?.n ?? 0), 1);
  });

  it("shouldPause 守卫命中即返回 done=false，不动数据不置标记", async () => {
    const sid = await newSession();
    const a1 = await insertLegacyRow(sid, 1, "assistant", assistantToolContent(1));

    const result = await runToolUseCountBackfill(conn(), {
      shouldPause: () => true,
    });
    assert.equal(result.done, false);
    assert.equal(await toolUseCountOf(a1), null);
    const marker = await conn().query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM kkv_entry WHERE module = ? AND key = ?",
      [TOOL_USE_COUNT_KKV_MODULE, TOOL_USE_COUNT_KKV_KEY]
    );
    assert.equal(Number(marker[0]?.n ?? 0), 0);
  });

  it("坏行（解压必抛）计数写 0 隔离、failedCount 记数，仍置完成标记", async () => {
    const sid = await newSession();
    const good = await insertLegacyRow(sid, 1, "assistant", assistantToolContent(1));
    const bad = await insertLegacyRow(sid, 2, "assistant", assistantToolContent(3), {
      corruptBlob: true,
    });

    const result = await runToolUseCountBackfill(conn());
    assert.equal(result.done, true);
    assert.equal(result.backfilledCount, 2);
    assert.equal(result.failedCount, 1);
    assert.equal(await toolUseCountOf(good), 1);
    assert.equal(await toolUseCountOf(bad), 0);
  });

  it("repository 新写入的行不进谓词（恒非 NULL，无需回填）", async () => {
    const sid = await newSession();
    await insertLegacyRow(sid, 1, "assistant", assistantToolContent(1));
    // repository 正常写入一条带 2 个 tool_use 的 assistant 行（写入时落列）。
    const { SqliteMessageRepository } = await import(
      "../../src/domain/chat/repositories/impl/sqlite-message.repository.js"
    );
    const repo = new SqliteMessageRepository(conn());
    const ctx = getNovelMasterTestContext();
    const repoId = randomUUID();
    await repo.insert({
      id: repoId,
      sessionId: sid,
      seq: 2,
      role: "assistant",
      content: assistantToolContent(2),
      provider: null,
      providerId: null,
      modelName: null,
      raw: null,
      createdAtMs: Date.now(),
      hidden: false,
    });
    void ctx;

    const result = await runToolUseCountBackfill(conn());
    // 只回填 legacy 那条；repository 行不在 NULL 谓词里。
    assert.equal(result.backfilledCount, 1);
    assert.equal(await toolUseCountOf(repoId), 2);
    const pending = await conn().query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM chat_message
       WHERE role = 'assistant' AND tool_use_count IS NULL`
    );
    assert.equal(Number(pending[0]?.n ?? 0), 0);
  });
});
