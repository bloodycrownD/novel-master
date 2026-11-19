/**
 * T-S12 / T-S13（signal-abort-scope Step 8）：message repository 分片检查点。
 *
 * - T-S12：`mapRows` 在分片之间命中取消时返回 `Outcome.cancelled`，**不返回
 *   半份结果**（通过后再让路：中断点先于既有 `yieldFn`，命中时让步零次）；
 * - T-S13：`batchInsert` 在分片之间命中取消时返回 `Outcome.cancelled`，事务
 *   边界转 `throw createAbortError()` 触发**整体回滚**，目标表无本批残留；
 *   外层事务路径（copy/fork 形态）由外层边界回滚。
 *
 * 检查点判空口径：`hooks?.checkpoint?.()` 未注入时是 `undefined`，实现必须
 * 用宽松的 `!= null`；本文件同时以「不传 hooks 的直通读」锁住该形态。
 *
 * @module test/chat/message-repository-abort
 */
import { unwrap } from "../helpers/result-unwrap.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { TextBlocks } from "@novel-master/core/chat";
import type { ChatMessageData } from "../../src/domain/chat/model/message.js";
import type { Interrupt } from "../../src/errors/outcome.js";
import { AbortError } from "../../src/domain/abort/logic/create-abort-error.js";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 第 `call` 次 `checkpoint()` 调用命中取消（入口判停是第 1 次）。 */
function cancelAt(call: number): { checkpoint: () => Interrupt | null; calls: () => number } {
  let calls = 0;
  return {
    checkpoint: () => {
      calls += 1;
      return calls >= call ? { kind: "cancelled", reason: "user-stop" } : null;
    },
    calls: () => calls,
  };
}

/** 直接构造批量写入素材（跳过 append 的分片读，聚焦 batchInsert 本身）。 */
function makeMessages(sessionId: string, count: number): ChatMessageData[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    sessionId,
    seq: index + 1,
    role: index % 2 === 0 ? "user" : "assistant",
    content: TextBlocks.of(`批量消息 ${index}`),
    provider: null,
    raw: null,
    createdAtMs: now,
    hidden: false,
  }));
}

/** 驱动把非 TdbcError 包一层时沿 cause 链找 AbortError。 */
function isAbortErrorLike(error: unknown): boolean {
  for (let cur: unknown = error, depth = 0; cur != null && typeof cur === "object" && depth < 8; depth += 1, cur = (cur as { cause?: unknown }).cause) {
    if ((cur as { name?: unknown }).name === "AbortError") {
      return true;
    }
  }
  return false;
}

describe("message repository 分片取消（T-S12 / T-S13）", () => {
  it("T-S12: 120 行 mapRows 在第二个分片边界命中取消——返回 cancelled、不返回半份结果、让步零次", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`P-ts12-${testIsolationSuffix()}`));
    const session = unwrap(await ctx.sessions.create(project.id));
    for (let i = 0; i < 120; i++) {
      unwrap(await ctx.messages.append(session.id, i % 2 === 0 ? "user" : "assistant", TextBlocks.of(`消息 ${i}`)));
    }

    // 直通基准：不传 hooks（`hooks?.checkpoint?.()` 得 undefined）必须走 completed。
    const plain = await new SqliteMessageRepository(ctx.conn).listBySession(session.id);
    assert.equal(plain.kind, "completed");
    if (plain.kind === "completed") {
      assert.equal(plain.value.length, 120);
    }

    let yieldCalls = 0;
    const repo = new SqliteMessageRepository(ctx.conn, async () => {
      yieldCalls += 1;
    });
    // 第 1 次 = 入口判停（null），第 2 次 = 第一个分片边界（命中）——120 行
    // 分 50/50/20 三片，中断落在「已解析第一片、尚未让路」的边界上。
    const gate = cancelAt(2);
    const result = await repo.listBySession(session.id, undefined, { checkpoint: gate.checkpoint });

    assert.equal(result.kind, "cancelled");
    assert.deepEqual(result, { kind: "cancelled", reason: "user-stop" });
    // 检查点先于既有 yieldFn：命中时一次让步都不该发生。
    assert.equal(yieldCalls, 0);
    assert.equal(gate.calls(), 2);
    // 结构上只有中断分支：拿不到半份消息数组。
    assert.equal("value" in result, false);
  });

  it("T-S13: batchInsert 第二个分片边界命中取消——小事务整体回滚、目标表无本批残留", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`P-ts13-${testIsolationSuffix()}`));
    const target = unwrap(await ctx.sessions.create(project.id));
    const repo = new SqliteMessageRepository(ctx.conn);
    const messages = makeMessages(target.id, 450);

    // 第 1 次 = 入口判停（null），第 2 次 = 第一片 200 条下发后的分片边界（命中）。
    const gate = cancelAt(2);
    const result = await repo.batchInsert(messages, { checkpoint: gate.checkpoint });

    assert.equal(result.kind, "cancelled");
    assert.deepEqual(result, { kind: "cancelled", reason: "user-stop" });
    assert.equal(gate.calls(), 2);
    // 回滚证据：第一片已经 batch 过（检查点在 c.batch 之后），但目标表零残留。
    assert.equal(await repo.countBySession(target.id), 0);
  });

  it("T-S13: 外层事务路径（copy/fork 形态）——batchInsert 交回 cancelled，外层边界回滚后零残留", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`P-ts13o-${testIsolationSuffix()}`));
    const target = unwrap(await ctx.sessions.create(project.id));
    const messages = makeMessages(target.id, 450);
    const gate = cancelAt(2);

    await assert.rejects(
      () =>
        ctx.conn.transaction(async (tx) => {
          // tx 句柄进 batchInsert：runInTransactionOrConn 走 NESTED_TRANSACTION 兜底，
          // 中断以小事务 throw 产生、再由 batchInsert 转回 Outcome.cancelled。
          const inserted = await new SqliteMessageRepository(tx).batchInsert(messages, { checkpoint: gate.checkpoint });
          assert.equal(inserted.kind, "cancelled");
          // 外层事务边界（copy/fork）：不 throw 就会 commit 半批，必须抛错回滚。
          throw AbortError.create();
        }),
      isAbortErrorLike
    );

    const countRepo = new SqliteMessageRepository(ctx.conn);
    assert.equal(await countRepo.countBySession(target.id), 0);
  });
});
