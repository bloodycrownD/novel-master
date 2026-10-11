/**
 * 稳态读性能护栏（T-MP-P0，V1' 收敛版）。
 *
 * 原护栏为「明文化对稳态读是纯收益」：同 fixture 造压缩形态基线库与明文
 * 形态库各跑一次 tail 加载，断言明文不劣化于「同 fixture 压缩形态 +
 * inflate」基线。该主张已随 V1' 退役闭环——压缩形态读路径本身不再存在
 * （readRowContent 的 blob 双形态分支随 decodeMessageContent 删除，存量
 * 压缩行已由反向搬运任务实测归零），倍数比较失去对照组，整条相对护栏
 * 使命完成。
 *
 * 保留的是同一条主张的绝对面：明文形态的 tail 加载不得劣化到预算之外
 * （`ABSOLUTE_BUDGET_MS`），防「读路径某次改动把稳态读拖到卡死量级」
 * 这类数量级回归——对齐 RULE「性能护栏取数量级回归线」：卡数量级（不许
 * 慢），不卡小数点（不拿环境噪声当回归）。
 *
 * @module test/chat/message-content-perf-threshold
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
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

/** tail 加载的条数（对齐原 T-C11 的 40 条 × 20KB）。 */
const ROWS = 40;

/**
 * 绝对预算上限：tail 耗时超过它就失败。
 *
 * 兜的是「读路径被某次改动拖到卡死/严重换页」这类数量级回归。取 5000ms：
 * 40 条 × 20KB 的实测在毫秒量级，5000ms 是三四个数量级的余量，只有真正
 * 卡死才会触顶。同机并行全量测试时两侧会一起被拖慢，故只设绝对预算、
 * 不设相对倍数（倍数护栏随压缩形态读路径一并退役，见文件头）。
 */
const ABSOLUTE_BUDGET_MS = 5000;

/**
 * 两侧夹具共用的 role 序列（护栏同构前提）。
 *
 * 若 role 进了读路径（按 role 过滤/拼接），造数与读数两侧不同构就会让
 * 护栏失真，劣化静默通过。故此处抽成单一函数，不允许各写一份表达式。
 */
function roleAt(index: number): ChatMessage["role"] {
  return index % 2 === 0 ? "assistant" : "user";
}

/** 计时一次 tail 加载（返回消息条数与耗时，供调用方断言内容与耗时）。 */
async function timeTail(
  sessionId: string
): Promise<{ count: number; ms: number }> {
  const repo = new SqliteMessageRepository(getNovelMasterTestContext().conn);
  // 预热一次（JIT / SQLite 页缓存），再计时取稳定值。
  await repo.listBySessionTail(sessionId, ROWS);
  const t0 = Date.now();
  const tail = await repo.listBySessionTail(sessionId, ROWS);
  return { count: tail.length, ms: Date.now() - t0 };
}

describe("稳态读性能护栏（T-MP-P0：明文 tail 加载绝对预算）", () => {
  it(`${ROWS} 条 × 20KB tail 加载：明文形态耗时不超绝对预算`, async () => {
    const ctx = getNovelMasterTestContext();
    const body = largeTextBody();

    // 明文形态库：走生产写路径（batchInsert 直写明文）。
    const plainProject = await ctx.projects.create(
      `P-${testIsolationSuffix()}`
    );
    const plainSession = await ctx.sessions.create(
      plainProject.id,
      `S-${testIsolationSuffix()}`
    );
    const messages: ChatMessage[] = [];
    for (let i = 1; i <= ROWS; i++) {
      messages.push({
        id: randomUUID(),
        sessionId: plainSession.id,
        seq: i,
        role: roleAt(i),
        content: textBlocks(body),
        provider: null,
        raw: null,
        createdAtMs: Date.now() + i,
        hidden: false,
      });
    }
    const repo = new SqliteMessageRepository(ctx.conn);
    await repo.batchInsert(messages);
    const plain = await timeTail(plainSession.id);
    assert.equal(plain.count, ROWS, "明文库应读到 40 条");

    // 内容深比对：读回同一份正文，防「护栏量的是一个空/错结果的库」
    // （空 blocks / 内容错位必须红——原护栏同款口径）。
    const tail = await repo.listBySessionTail(plainSession.id, ROWS);
    assert.deepEqual(
      tail.map((message) => message.content),
      messages.map((message) => message.content)
    );

    // 绝对预算：明文 tail 耗时不得劣化到预算之外（数量级回归护栏）。
    assert.ok(
      plain.ms <= ABSOLUTE_BUDGET_MS,
      `明文 tail 耗时 ${plain.ms}ms 超绝对预算 ${ABSOLUTE_BUDGET_MS}ms（读路径数量级回归）`
    );
  });
});
