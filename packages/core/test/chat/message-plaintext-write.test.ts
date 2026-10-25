/**
 * chat_message 全库明文化：写侧形态与重复读稳定性用例
 * （T-MP1 / T-MP6）。
 *
 * 覆盖两条承重约束：
 * - **T-MP1** 写侧三态：新行 content_json 非空且压缩两列为 NULL；且
 *   updateContent 改写一条既有行后三列齐置——三列齐置是行级单形态卫生，
 *   漏置 blob 两列会在行上留下旧形态。
 * - **T-MP6** 重复读正确性：同一行多次读取结果一致（读路径无进程内
 *   正文池，每次重新 parse——性能不设断言，只锁正确性）。
 *
 * 读路径单形态收敛（V1' 退役后）：存量压缩行已由反向搬运任务全部解回
 * 明文（真实库谓词归零 + KKV decompressDone 已置实测确认），正文读取的
 * blob 双形态分支随 decodeMessageContent 退役，迁移期混存读（原 T-MP4）
 * 使命完成、用例删除。
 *
 * @module test/chat/message-plaintext-write
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
import type {
  ChatMessageData,
  MessageContent,
} from "../../src/domain/chat/model/message.js";

novelMasterTestFixture();

/** 造一条可插入的可见消息。 */
function messageFixture(
  sessionId: string,
  seq: number,
  content: MessageContent
): ChatMessageData {
  return {
    id: randomUUID(),
    sessionId,
    seq,
    role: seq % 2 === 0 ? "assistant" : "user",
    content,
    provider: null,
    raw: null,
    createdAtMs: Date.now() + seq,
    hidden: false,
  };
}

/** 新建一个会话并返回 repo。 */
async function newSession(): Promise<{
  sessionId: string;
  repo: SqliteMessageRepository;
}> {
  const ctx = getNovelMasterTestContext();
  const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
  const session = await ctx.sessions.create(
    project.id,
    `S-${testIsolationSuffix()}`
  );
  return { sessionId: session.id, repo: new SqliteMessageRepository(ctx.conn) };
}

/** 直查某行的三列原始形态。 */
async function rawContentColumns(id: string): Promise<{
  encoding: string | null;
  blobIsNull: boolean;
  contentJson: string | null;
}> {
  const ctx = getNovelMasterTestContext();
  const rows = await ctx.conn.query<{
    content_encoding: string | null;
    content_blob: unknown;
    content_json: string | null;
  }>(
    `SELECT content_encoding, content_blob, content_json
     FROM chat_message WHERE id = ?`,
    [id]
  );
  const row = rows[0]!;
  return {
    encoding: row.content_encoding,
    blobIsNull: row.content_blob == null,
    contentJson: row.content_json == null ? null : String(row.content_json),
  };
}

describe("chat_message 全库明文化（T-MP1 / T-MP6）", () => {
  it("T-MP1：append/batchInsert 写明文——content_json 非空、encoding/blob 为 NULL", async () => {
    const { sessionId, repo } = await newSession();
    const content = textBlocks("明文化写入的第一条");

    // append（insert）
    const single = messageFixture(sessionId, 1, content);
    await repo.insert(single);
    const singleRaw = await rawContentColumns(single.id);
    assert.equal(
      singleRaw.contentJson,
      JSON.stringify(content),
      "content_json 应直存 blocks JSON 明文"
    );
    assert.equal(singleRaw.encoding, null, "新行 content_encoding 必须为 NULL");
    assert.equal(singleRaw.blobIsNull, true, "新行 content_blob 必须为 NULL");

    // batchInsert（fork/copy 的全量写口）
    const batched = [
      messageFixture(sessionId, 2, textBlocks("批量写入的第二条")),
      messageFixture(sessionId, 3, textBlocks("批量写入的第三条")),
    ];
    await repo.batchInsert(batched);
    for (const message of batched) {
      const raw = await rawContentColumns(message.id);
      assert.equal(raw.contentJson, JSON.stringify(message.content));
      assert.equal(raw.encoding, null, "批量写入行 encoding 必须为 NULL");
      assert.equal(raw.blobIsNull, true, "批量写入行 blob 必须为 NULL");
    }

    // 读回等价。
    const list = await repo.listBySession(sessionId);
    assert.equal(list.length, 3);
    assert.deepEqual(list[0]!.content, content);
  });

  it("T-MP1 反例：updateContent 改写既有行后三列齐置（行级单形态卫生，漏置 blob 两列会留下旧形态）", async () => {
    const { sessionId, repo } = await newSession();
    const oldContent = textBlocks("编辑前的旧正文");
    const plain = messageFixture(sessionId, 1, oldContent);
    await repo.insert(plain);

    // 前置事实：明文行可读。
    const before = await repo.findById(plain.id);
    assert.ok(before);
    assert.deepEqual(before!.content, oldContent);

    // 编辑：这条行走 updateContent。
    const newContent = textBlocks("编辑后的新正文，应覆盖旧正文");
    assert.equal(await repo.updateContent(plain.id, newContent), true);

    // 三列齐置：明文列写新值，两列显式置 NULL。
    const raw = await rawContentColumns(plain.id);
    assert.equal(raw.contentJson, JSON.stringify(newContent));
    assert.equal(
      raw.encoding,
      null,
      "content_encoding 必须齐置为 NULL（三列齐置是行级单形态卫生）"
    );
    assert.equal(
      raw.blobIsNull,
      true,
      "content_blob 必须齐置为 NULL——三列齐置是行级单形态卫生，避免旧 blob 残留让同一行被看成双形态"
    );

    // 读回新正文：读路径只认 content_json，验证写入已生效。
    const after = await repo.findById(plain.id);
    assert.ok(after);
    assert.deepEqual(
      after!.content,
      newContent,
      "编辑后必须读到新正文（读到旧正文 = 三列未齐置）"
    );
    // listBySession 同款（读路径不止 findById 一处）。
    const list = await repo.listBySession(sessionId);
    assert.equal(list.length, 1);
    assert.deepEqual(list[0]!.content, newContent);
  });

  it("batchInsert 嵌套在 conn.transaction 内（生产 fork/copy 形态）不抛 NESTED_TRANSACTION 且插入完整", async () => {
    const ctx = getNovelMasterTestContext();
    const { sessionId } = await newSession();
    const rows = [
      messageFixture(sessionId, 1, textBlocks("事务内批量第一条")),
      messageFixture(sessionId, 2, textBlocks("事务内批量第二条")),
      messageFixture(sessionId, 3, textBlocks("事务内批量第三条")),
    ];

    // 生产路径形态：fork（message.service）与 copy（session.service）都在
    // conn.transaction(async tx => reposFor(tx)) 的**外层事务内**调
    // batchInsert，repo 持有的 this.conn 就是 tx 句柄——tx 句柄的
    // transaction() 无条件抛 NESTED_TRANSACTION，batchInsert 必须运行时
    // 判定并回落 fn(tx) 直通，否则 fork/copy 当场炸。
    // 没有这条，嵌套判定若被移除，事务外直调用例依然全绿。
    await ctx.conn.transaction(async (tx) => {
      await new SqliteMessageRepository(tx).batchInsert(rows);
    });

    const list = await ctx.messages.listBySession(sessionId);
    assert.equal(list.length, 3, "事务内 batchInsert 的三行都应落库且已提交");
    assert.deepEqual(
      list.map((m) => m.content),
      rows.map((m) => m.content)
    );
  });

  it("T-MP6：无正文池环境下重复读结果一致", async () => {
    const { sessionId, repo } = await newSession();
    const content = textBlocks(`重复读稳定性-${testIsolationSuffix()}`);
    const plain = messageFixture(sessionId, 1, content);
    await repo.insert(plain);

    // 原消息正文池随明文化删除；读路径无进程内缓存，重复读每次都重新
    // parse——正确性不得因此变化。
    for (let i = 0; i < 3; i++) {
      const read = await repo.findById(plain.id);
      assert.ok(read, `第 ${i + 1} 次读应命中行`);
      assert.deepEqual(
        read!.content,
        content,
        `第 ${i + 1} 次读结果不一致（无池环境下重复读必须稳定）`
      );
    }
    const list = await repo.listBySession(sessionId);
    assert.deepEqual(list[0]!.content, content);
  });
});
