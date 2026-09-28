/**
 * 消息正文压缩性能阈值用例（T-C11，非 blocking）。
 *
 * 口径（ic-11 改为相对基线，方案 A）：同一 fixture 先建「同构明文库」
 * 跑一次测基线耗时（读路径只 parse 不解压），阈值 = 基线 × 25。倍率
 * 标定：本机空载实测「含解压/压缩耗时 / 明文基线」固有比值 3.6 ~ 4.1
 * （解压/压缩是必要开销，非退化）；但全量测试并行负载下解压路径被
 * 显著拖慢而明文基线几乎不受影响，实测比值可冲到 11.4（91ms/8ms）——
 * 阈值卡在空载值附近等于拿并行噪声当回归（假红）。取 25 兼顾两端：
 * 覆盖并行噪声余量，同时兜「差一个数量级」的退化（decompress 慢 10
 * 倍 ⇒ 固有比值 36+，空载/并行都必红），不做更紧的回归保护。内容断
 * 言为全量深比对（解压错位 / 空 blocks 必须红）。SPEC 后续评审可调倍率。
 *
 * @module test/chat/message-content-perf-threshold
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import {
  MESSAGE_COMPACTION_KKV_KEY,
  MESSAGE_COMPACTION_KKV_MODULE,
  runMessageContentCompaction,
} from "../../src/infra/db-maintenance/index.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";

novelMasterTestFixture();

/**
 * 清压缩完成标记（ic-26）：用例自管标记状态——本文件其它用例将来若
 * 引入压缩调用，不得依赖本用例的「标记未置」隐式前提；共享库约定下
 * 先清完成标记再断言，把前提钉进代码而不是靠用例次序侥幸。
 * 常量经 infra/db-maintenance 内部出口相对路径导入（不经主入口——
 * ic-13 已把这两个常量从主出口撤除）。
 */
async function clearDoneMarker(): Promise<void> {
  const ctx = getNovelMasterTestContext();
  await ctx.conn.execute(
    "DELETE FROM kkv_entry WHERE module = ? AND key = ?",
    [MESSAGE_COMPACTION_KKV_MODULE, MESSAGE_COMPACTION_KKV_KEY]
  );
}

/** 20KB 量级中文正文（对齐重度长会话单条消息体量）。 */
function largeTextBody(): string {
  return `二十KB量级的中文正文样本。${"云舟渡口灯火渐起，少年负剑西行。".repeat(
    512
  )}`;
}

describe("消息正文压缩性能阈值（T-C11）", () => {
  it("40 条 × 20KB tail 加载（含解压）相对同构明文库基线不劣化到可感知", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteMessageRepository(ctx.conn);

    const body = largeTextBody();
    const blocksJson = JSON.stringify({ blocks: [{ type: "text", text: body }] });

    // 基线（方案 A）：同构明文库——同样 40 条 × 20KB 明文行，读路径只
    // parse 不解压。预热一次（JIT / 页缓存）后计时一次取稳定值。
    const plainProject = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const plainSession = await ctx.sessions.create(
      plainProject.id,
      `S-${testIsolationSuffix()}`
    );
    for (let i = 1; i <= 40; i++) {
      await ctx.conn.execute(
        `INSERT INTO chat_message (
           id, session_id, seq, role, content_json, created_at_ms, hidden
         ) VALUES (?, ?, ?, 'user', ?, ?, 0)`,
        [randomUUID(), plainSession.id, i, blocksJson, Date.now() + i]
      );
    }
    await repo.listBySessionTail(plainSession.id, 40);
    const tBase = Date.now();
    const plainTail = await repo.listBySessionTail(plainSession.id, 40);
    const baselineMs = Date.now() - tBase;
    assert.equal(plainTail.length, 40);

    // 基线行用完即清：明文行命中压缩谓词，残留会让同文件用例 2 的
    // 「恰 100 行明文」前提静默失效（ic-26 用例自管口径）。
    await ctx.conn.execute(
      "DELETE FROM chat_message WHERE session_id = ?",
      [plainSession.id]
    );

    // 压缩库：repository 写入路径压缩落库（zlib 二进制形态）。
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(
      project.id,
      `S-${testIsolationSuffix()}`
    );
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
    // 内容深比对（ic-11）：解压错位 / 空 blocks 必须红——原断言只看
    // tail[0] 块类型，解压错了也能绿。
    assert.deepEqual(
      tail.map((message) => message.content),
      messages.map((message) => message.content)
    );
    // 相对基线阈值（方案 A）：同构明文库基线 × 25。口径：两库行数/条数/
    // 体量一致，唯一差别是读路径多解压；空载固有比值 ~3.6、全量并行
    // 实测最高 11.4（见文件头），25 倍兜数量级退化（慢 10 倍 ⇒ 36+ 仍红）。
    assert.ok(
      tailMs < baselineMs * 25,
      `tail 加载（含解压）耗时 ${tailMs}ms 超同构明文基线 ${baselineMs}ms 的 25 倍（insert ${insertMs}ms）`
    );
  });

  it("压缩搬运单批（100 行）相对同构明文基线不劣化到可感知", async () => {
    // ic-26：用例自管标记状态——本文件其它用例将来若引入压缩调用，
    // 不得依赖本用例的标记初值；共享库约定下先清完成标记再断言
    // 「标记未置 + 恰 100 行明文」的前提。
    await clearDoneMarker();

    const ctx = getNovelMasterTestContext();
    const repo = new SqliteMessageRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(
      project.id,
      `S-${testIsolationSuffix()}`
    );

    const body = largeTextBody();
    const blocksJson = JSON.stringify({ blocks: [{ type: "text", text: body }] });
    // 100 条明文行（一批）：手工 INSERT 明文模拟存量。
    for (let i = 1; i <= 100; i++) {
      await ctx.conn.execute(
        `INSERT INTO chat_message (
           id, session_id, seq, role, content_json, created_at_ms, hidden
         ) VALUES (?, ?, ?, 'user', ?, ?, 0)`,
        [randomUUID(), session.id, i, blocksJson, Date.now() + i]
      );
    }

    // 基线（方案 A 同口径）：同构明文全量读取（SELECT + parse，无压缩/
    // 解压参与）先跑一次——预热一次后计时。压缩搬运 = 谓词扫描 + 100
    // 行读 + 压缩 + 写回 + 标记 + 收尾 VACUUM，阈值 = 基线 × 3。
    await repo.listBySession(session.id);
    const tBase = Date.now();
    await repo.listBySession(session.id);
    const baselineMs = Date.now() - tBase;

    const t0 = Date.now();
    const result = await runMessageContentCompaction(ctx.conn, {
      syncBudgetMs: 60_000,
    });
    const compactionMs = Date.now() - t0;

    assert.equal(result.done, true);
    assert.equal(result.compactedCount, 100);
    // 相对基线阈值（方案 A 同口径）：基线 × 25。空载固有比值 ~4.1
    // （压缩 + 写回 + VACUUM 为必要开销；原 30s 绝对阈值相对实测有
    // 百倍余量，近乎恒真）；并行负载下比值进一步放大（见文件头），
    // 25 倍兜数量级退化。
    assert.ok(
      compactionMs < baselineMs * 25,
      `压缩搬运单批耗时 ${compactionMs}ms 超同构明文基线 ${baselineMs}ms 的 25 倍`
    );

    // 压缩后读回内容等价（轻量抽查，防解压错位——同 ic-11 内容口径）。
    const sample = await repo.listBySessionTail(session.id, 1);
    assert.equal(sample.length, 1);
    assert.deepEqual(sample[0]!.content, textBlocks(body));
  });
});
