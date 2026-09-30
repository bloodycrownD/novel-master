/**
 * chat_message 全库明文化：写侧形态与迁移期双形态读用例
 * （T-MP1 / T-MP4 / T-MP6）。
 *
 * 覆盖三条承重约束：
 * - **T-MP1** 写侧三态：新行 content_json 非空且压缩两列为 NULL；且
 *   updateContent 改写一条**存量压缩行**后三列齐置——反例（只写
 *   content_json、漏置 blob 两列）会静默读回旧正文，是数据错乱而非崩溃，
 *   必须有牙锁死。
 * - **T-MP4** 迁移期混存：同库压缩行 + 明文行混合，listBySession / tail
 *   正确分派（压缩行永远合法的反向契约）。
 * - **T-MP6** 池删除正确性：存量压缩行在无 messageContentPool 的环境下
 *   重复读结果一致（性能不设断言，只锁正确性）。
 *
 * 存量压缩行的构造**不经生产 API**：明文化后 `batchInsert` 只写明文、正向
 * 压缩任务即将整文件删除，已无生产 API 能造压缩行。用 `compressZlib` +
 * 裸 `INSERT INTO chat_message` 直造，与生产写路径解耦。
 *
 * @module test/chat/message-plaintext-write
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import {
  compressZlib,
  VFS_CONTENT_ENCODING_ZLIB,
} from "../../src/domain/vfs/content-store/logic/zlib-codec.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";
import type {
  ChatMessage,
  MessageContent,
} from "../../src/domain/chat/model/message.js";

novelMasterTestFixture();

/** 造一条可插入的可见消息。 */
function messageFixture(
  sessionId: string,
  seq: number,
  content: MessageContent
): ChatMessage {
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

/**
 * 裸 INSERT 造一条存量压缩形态行（形态与压缩时代生产写侧逐字对齐：
 * content_json 置空串、content_encoding='zlib'、content_blob 为二进制）。
 */
async function insertCompressedRow(args: {
  sessionId: string;
  seq: number;
  content: MessageContent;
}): Promise<string> {
  const ctx = getNovelMasterTestContext();
  const id = randomUUID();
  const blob = compressZlib(
    new TextEncoder().encode(JSON.stringify(args.content))
  );
  await ctx.conn.execute(
    `INSERT INTO chat_message (
       id, session_id, seq, role, content_json, content_encoding, content_blob,
       created_at_ms, hidden
     ) VALUES (?, ?, ?, 'user', '', ?, ?, ?, 0)`,
    [
      id,
      args.sessionId,
      args.seq,
      VFS_CONTENT_ENCODING_ZLIB,
      blob,
      Date.now() + args.seq,
    ]
  );
  return id;
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

describe("chat_message 全库明文化（T-MP1 / T-MP4 / T-MP6）", () => {
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

  it("T-MP1 反例：updateContent 改写存量压缩行后三列齐置（漏置 blob 则静默读回旧正文）", async () => {
    const { sessionId, repo } = await newSession();
    const oldContent = textBlocks("压缩形态的旧正文");
    const id = await insertCompressedRow({
      sessionId,
      seq: 1,
      content: oldContent,
    });

    // 前置事实：压缩行可读（迁移期双形态）。
    const before = await repo.findById(id);
    assert.ok(before);
    assert.deepEqual(before!.content, oldContent);

    // 编辑：这条行走 updateContent。
    const newContent = textBlocks("编辑后的新正文，应覆盖旧压缩内容");
    assert.equal(await repo.updateContent(id, newContent), true);

    // 三列齐置：明文列写新值，两列显式置 NULL。
    const raw = await rawContentColumns(id);
    assert.equal(raw.contentJson, JSON.stringify(newContent));
    assert.equal(
      raw.encoding,
      null,
      "content_encoding 必须齐置为 NULL（漏置则 encoding/blob 仍是旧值）"
    );
    assert.equal(
      raw.blobIsNull,
      true,
      "content_blob 必须齐置为 NULL——只写 content_json 时读路径「blob 非空优先」会解压出旧正文"
    );

    // 承重断言：读回的是新正文，不是旧压缩内容。
    // 反例锁死：若 SET 漏掉 content_blob = NULL，此处会读到 oldContent。
    const after = await repo.findById(id);
    assert.ok(after);
    assert.deepEqual(
      after!.content,
      newContent,
      "编辑压缩行后必须读到新正文（读到旧正文 = 三列未齐置）"
    );
    // listBySession 同款（读路径不止 findById 一处）。
    const list = await repo.listBySession(sessionId);
    assert.equal(list.length, 1);
    assert.deepEqual(list[0]!.content, newContent);
  });

  it("T-MP4：迁移期混存读——同库压缩行与明文行混合，listBySession/tail 正确分派", async () => {
    const { sessionId, repo } = await newSession();
    const compressedContent = textBlocks("压缩形态正文");
    const plainContent = textBlocks("明文形态正文");

    // 压缩行（裸 INSERT 直造）+ 明文行（生产写路径）交错排列。
    const compressedId = await insertCompressedRow({
      sessionId,
      seq: 1,
      content: compressedContent,
    });
    const plainA = messageFixture(sessionId, 2, plainContent);
    await repo.insert(plainA);
    const compressedId2 = await insertCompressedRow({
      sessionId,
      seq: 3,
      content: textBlocks("第二条压缩正文"),
    });
    const plainB = messageFixture(sessionId, 4, textBlocks("第二条明文正文"));
    await repo.insert(plainB);

    const list = await repo.listBySession(sessionId);
    assert.equal(list.length, 4, "混存一条不少");
    assert.deepEqual(
      list.map((m) => m.content),
      [
        compressedContent,
        plainContent,
        { blocks: [{ type: "text", text: "第二条压缩正文" }] },
        { blocks: [{ type: "text", text: "第二条明文正文" }] },
      ],
      "两种形态按行分派，无错位"
    );

    // tail / page 路径同样双形态还原。
    const tail = await repo.listBySessionTail(sessionId, 4);
    assert.deepEqual(
      tail.map((m) => m.content),
      list.map((m) => m.content)
    );
    // page 路径同样双形态还原（无 beforeSeq = 取最新 2 条：seq 3 压缩 +
    // seq 4 明文——刻意让两形态相邻，证明分派不按形态分群）。
    const page = await repo.listBySessionPage(sessionId, 2);
    assert.equal(page.length, 2);
    assert.deepEqual(
      page.map((m) => m.content),
      [
        { blocks: [{ type: "text", text: "第二条压缩正文" }] },
        { blocks: [{ type: "text", text: "第二条明文正文" }] },
      ]
    );

    // findById 逐条打靶，两形态 id 都能定位。
    assert.deepEqual((await repo.findById(compressedId))!.content, compressedContent);
    assert.deepEqual((await repo.findById(compressedId2))!.content, {
      blocks: [{ type: "text", text: "第二条压缩正文" }],
    });
  });

  it("T-MP6：池删除正确性——存量压缩行重复读结果一致（无 messageContentPool 环境）", async () => {
    const { sessionId, repo } = await newSession();
    const content = textBlocks(`池删除后的重复读-${testIsolationSuffix()}`);
    const id = await insertCompressedRow({ sessionId, seq: 1, content });

    // 原消息正文池随明文化删除（键 = message id + 四处写口失效义务）。
    // 重复读现在每次都重新 inflate——正确性不得因此变化。
    for (let i = 0; i < 3; i++) {
      const read = await repo.findById(id);
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
