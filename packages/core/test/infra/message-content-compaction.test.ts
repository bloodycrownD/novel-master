/**
 * 消息正文压缩搬运任务用例（T-C7 ~ T-C9 + 守卫/状态采样）。
 *
 * 幂等与可重入口径见 spec「总体方案 3」：谓词 content_json != ''，
 * 批 ≤100 行短事务，完成置 KKV 标记（两段式 nm-message-content/
 * compactionDone）。共享库上每个用例自管标记状态（开头清标记），
 * 与 file-cache-store.test.ts 的直查断言风格一致。
 *
 * @module test/infra/message-content-compaction
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import {
  runMessageContentCompaction,
  getMessageCompactionStatus,
  MESSAGE_COMPACTION_KKV_KEY,
  MESSAGE_COMPACTION_KKV_MODULE,
} from "../../src/infra/db-maintenance/index.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";
import type { ChatMessage, MessageContent } from "../../src/domain/chat/model/message.js";
import type { ContentBlock } from "../../src/domain/chat/model/content-block.js";

novelMasterTestFixture();

/** 每个用例开头自管标记状态：清 KKV 完成标记（幂等重入测试的地基）。 */
async function clearDoneMarker(): Promise<void> {
  const ctx = getNovelMasterTestContext();
  await ctx.conn.execute(
    "DELETE FROM kkv_entry WHERE module = ? AND key = ?",
    [MESSAGE_COMPACTION_KKV_MODULE, MESSAGE_COMPACTION_KKV_KEY]
  );
}

async function pendingCount(): Promise<number> {
  const ctx = getNovelMasterTestContext();
  const rows = await ctx.conn.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM chat_message WHERE content_json != ''"
  );
  return Number(rows[0]?.n ?? 0);
}

async function doneMarkerCount(): Promise<number> {
  const ctx = getNovelMasterTestContext();
  const rows = await ctx.conn.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM kkv_entry WHERE module = ? AND key = ?",
    [MESSAGE_COMPACTION_KKV_MODULE, MESSAGE_COMPACTION_KKV_KEY]
  );
  return Number(rows[0]?.n ?? 0);
}

/** 手工 INSERT 一条 legacy 明文行（模拟存量库 / e2e fixture）。 */
async function insertPlaintextRow(
  sessionId: string,
  seq: number,
  content: MessageContent,
  createdAtMs: number
): Promise<string> {
  const ctx = getNovelMasterTestContext();
  const id = randomUUID();
  await ctx.conn.execute(
    `INSERT INTO chat_message (
       id, session_id, seq, role, content_json, created_at_ms, hidden
     ) VALUES (?, ?, ?, 'user', ?, ?, 0)`,
    [id, sessionId, seq, JSON.stringify(content), createdAtMs]
  );
  return id;
}

/** 新建一个会话。 */
async function newSession(): Promise<string> {
  const ctx = getNovelMasterTestContext();
  const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
  const session = await ctx.sessions.create(project.id, `S-${testIsolationSuffix()}`);
  return session.id;
}

/** 混合内容构造：长中文 / tool_use / tool_result / thinking 块交替。 */
function mixedContent(i: number): MessageContent {
  const blocks: ContentBlock[] = [
    {
      type: "text",
      text: `第 ${i} 条混合消息：${"长中文正文测试。".repeat(20 + (i % 7))}`,
    },
  ];
  if (i % 3 === 0) {
    blocks.push({
      type: "tool_use",
      id: `tu-${i}`,
      name: "write",
      input: { path: `/第${i}章.md`, content: "章节草稿".repeat(30) },
    });
  }
  if (i % 3 === 1) {
    blocks.push({
      type: "tool_result",
      toolUseId: `tu-${i}`,
      content: `工具返回结果 ${i}：${"output".repeat(50)}`,
    });
  }
  if (i % 5 === 0) {
    blocks.push({ type: "thinking", text: `思考过程 ${i}` });
  }
  return { blocks };
}

describe("消息正文压缩搬运任务（T-C7 ~ T-C9）", () => {
  it("T-C7：幂等——跑两遍第二遍 no-op（谓词空、标记已置、零搬运）", async () => {
    await clearDoneMarker();
    const sessionId = await newSession();
    await insertPlaintextRow(sessionId, 1, textBlocks("幂等验证明文行"), Date.now());

    // 未完成态采样：done=false、pendingCount ≥ 1。
    const before = await getMessageCompactionStatus(getNovelMasterTestContext().conn);
    assert.equal(before.done, false);
    assert.ok(before.pendingCount >= 1);

    const first = await runMessageContentCompaction(getNovelMasterTestContext().conn);
    assert.equal(first.done, true);
    assert.ok(first.compactedCount >= 1);
    assert.equal(await pendingCount(), 0, "谓词应清空");
    assert.equal(await doneMarkerCount(), 1, "KKV 完成标记应已置（两段式）");

    // 第二遍：标记短路，零搬运。
    const second = await runMessageContentCompaction(getNovelMasterTestContext().conn);
    assert.equal(second.done, true);
    assert.equal(second.compactedCount, 0);

    // 完成态采样：done=true 零 COUNT 成本口径。
    const after = await getMessageCompactionStatus(getNovelMasterTestContext().conn);
    assert.equal(after.done, true);
    assert.equal(after.pendingCount, 0);

    // 搬运后消息仍可读且等价。
    const repo = new SqliteMessageRepository(getNovelMasterTestContext().conn);
    const list = await repo.listBySession(sessionId);
    assert.equal(list.length, 1);
    assert.deepEqual(list[0]!.content, textBlocks("幂等验证明文行"));
  });

  it("T-C8：可重入——批间中断（模拟杀进程）后重启续跑收敛", async () => {
    await clearDoneMarker();
    const sessionId = await newSession();
    // 120 条明文行：第一轮（预算 0ms）搬完第一批 100 行即中断，
    // 剩余 20 条由第二次调用收敛。
    for (let i = 1; i <= 120; i++) {
      await insertPlaintextRow(sessionId, i, mixedContent(i), Date.now() + i);
    }

    const interrupted = await runMessageContentCompaction(
      getNovelMasterTestContext().conn,
      { syncBudgetMs: 0 }
    );
    assert.equal(interrupted.done, false, "预算耗尽应返回未完成");
    assert.equal(interrupted.compactedCount, 100, "第一批 100 行已搬运");
    const remaining = await pendingCount();
    assert.equal(remaining, 20, "中断时剩余 20 条");
    assert.equal(await doneMarkerCount(), 0, "中断时完成标记未置");

    // 模拟重启：重新调用（默认预算），谓词重扫续跑收敛。
    const resumed = await runMessageContentCompaction(getNovelMasterTestContext().conn);
    assert.equal(resumed.done, true);
    assert.equal(resumed.compactedCount, 20, "只搬剩余 20 条（已搬行天然排除）");
    assert.equal(await pendingCount(), 0);
    assert.equal(await doneMarkerCount(), 1);

    // 全量读回：120 条一条不少。
    const repo = new SqliteMessageRepository(getNovelMasterTestContext().conn);
    const list = await repo.listBySession(sessionId);
    assert.equal(list.length, 120);
  });

  it("T-C9：零丢失——混合内容（长中文/附件/tool 块）搬运前后全量逐字节比对", async () => {
    await clearDoneMarker();
    const sessionId = await newSession();
    const originals: ChatMessage[] = [];
    // 50 条混合内容明文行 + 10 条走 repo.insert 的压缩行（混存搬运）。
    for (let i = 1; i <= 50; i++) {
      const content = mixedContent(i);
      await insertPlaintextRow(sessionId, i, content, Date.now() + i);
      originals.push({
        id: "",
        sessionId,
        seq: i,
        role: "user",
        content,
        provider: null,
        raw: null,
        createdAtMs: 0,
        hidden: false,
      });
    }
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteMessageRepository(ctx.conn);
    for (let i = 51; i <= 60; i++) {
      const message: ChatMessage = {
        id: randomUUID(),
        sessionId,
        seq: i,
        role: "assistant",
        content: mixedContent(i),
        provider: null,
        raw: null,
        createdAtMs: Date.now() + i,
        hidden: false,
        usage: { totalTokens: i * 10 },
      };
      await repo.insert(message);
      originals.push(message);
    }

    const result = await runMessageContentCompaction(ctx.conn);
    assert.equal(result.done, true);

    // 搬运前后全量逐字节比对：每条 content 的 JSON 序列化完全一致。
    const after = await repo.listBySession(sessionId);
    assert.equal(after.length, originals.length, "一条不少");
    for (const msg of after) {
      const original = originals.find((o) => o.seq === msg.seq);
      assert.ok(original, `seq=${msg.seq} 应存在`);
      assert.equal(
        JSON.stringify(msg.content),
        JSON.stringify(original.content),
        `seq=${msg.seq} 逐字节一致`
      );
    }
    // 全库明文谓词归零（spec 确认 SQL 口径）。
    assert.equal(await pendingCount(), 0);
  });

  it("批间守卫：shouldPause 命中时立即暂停，零搬运", async () => {
    await clearDoneMarker();
    const sessionId = await newSession();
    await insertPlaintextRow(sessionId, 1, textBlocks("守卫验证明文行"), Date.now());

    const paused = await runMessageContentCompaction(
      getNovelMasterTestContext().conn,
      { shouldPause: () => true }
    );
    assert.equal(paused.done, false);
    assert.equal(paused.compactedCount, 0, "守卫命中时零搬运");
    assert.equal(await doneMarkerCount(), 0);

    // 状态采样仍是进行中。
    const status = await getMessageCompactionStatus(getNovelMasterTestContext().conn);
    assert.equal(status.done, false);
    assert.ok(status.pendingCount >= 1);
  });
});
