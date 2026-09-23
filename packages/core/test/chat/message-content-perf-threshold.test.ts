/**
 * 消息正文压缩性能阈值用例（T-C11，非 blocking）。
 *
 * 口径：40 条 × 20KB tail 加载（含解压，对齐 40 条页界实测场景）与
 * 压缩搬运单批（100 行）耗时不劣化到可感知。阈值为宽松上限（防 CI
 * 机器性能波动 flaky），SPEC 后续评审可调。
 *
 * @module test/chat/message-content-perf-threshold
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import { runMessageContentCompaction } from "../../src/infra/db-maintenance/index.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";

novelMasterTestFixture();

/** 20KB 量级中文正文（对齐重度长会话单条消息体量）。 */
function largeTextBody(): string {
  return `二十KB量级的中文正文样本。${"云舟渡口灯火渐起，少年负剑西行。".repeat(
    512
  )}`;
}

describe("消息正文压缩性能阈值（T-C11）", () => {
  it("40 条 × 20KB tail 加载（含解压）耗时不劣化到可感知", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, `S-${testIsolationSuffix()}`);
    const repo = new SqliteMessageRepository(ctx.conn);

    const body = largeTextBody();
    const messages: ChatMessage[] = [];
    for (let i = 1; i <= 40; i++) {
      messages.push({
        id: randomUUID(),
        sessionId: session.id,
        seq: i,
        role: i % 2 === 0 ? "assistant" : "user",
        content: textBlocks(body),
        provider: null,
        raw: null,
        createdAtMs: Date.now() + i,
        hidden: false,
      });
    }
    const t0 = Date.now();
    await repo.batchInsert(messages);
    const insertMs = Date.now() - t0;

    const t1 = Date.now();
    const tail = await repo.listBySessionTail(session.id, 40);
    const tailMs = Date.now() - t1;

    assert.equal(tail.length, 40);
    assert.equal(tail[0]!.content.blocks[0]!.type, "text");
    // 宽松阈值：单次 40 条页界加载（含全量解压 + parse）< 5s。
    assert.ok(
      tailMs < 5_000,
      `tail 加载（含解压）耗时 ${tailMs}ms 超阈值（insert ${insertMs}ms）`
    );
  });

  it("压缩搬运单批（100 行）耗时不劣化到可感知", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, `S-${testIsolationSuffix()}`);

    const body = largeTextBody();
    // 100 条明文行（一批）：手工 INSERT 明文模拟存量。
    for (let i = 1; i <= 100; i++) {
      await ctx.conn.execute(
        `INSERT INTO chat_message (
           id, session_id, seq, role, content_json, created_at_ms, hidden
         ) VALUES (?, ?, ?, 'user', ?, ?, 0)`,
        [randomUUID(), session.id, i, JSON.stringify({ blocks: [{ type: "text", text: body }] }), Date.now() + i]
      );
    }

    const t0 = Date.now();
    const result = await runMessageContentCompaction(ctx.conn, {
      syncBudgetMs: 60_000,
    });
    const compactionMs = Date.now() - t0;

    assert.equal(result.done, true);
    assert.equal(result.compactedCount, 100);
    // 宽松阈值：100 行 × 20KB 单批压缩搬运 < 30s（含完成后 VACUUM）。
    assert.ok(
      compactionMs < 30_000,
      `压缩搬运单批耗时 ${compactionMs}ms 超阈值`
    );
  });
});
