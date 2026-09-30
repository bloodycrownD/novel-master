/**
 * chat_message 正文解压产物缓存集成用例（进程内统一层的读链之三）。
 *
 * 这条链的身份是**主键 id**（chat_message 没有内容哈希列），所以除了
 * 「投毒 + 反向锁」证明真命中之外，本文件还要钉住失效纪律：
 * - `updateContent` 是「同 id 换正文」的唯一写口，必须失效 → 否则读回旧正文；
 * - `insert` / `delete` 的防御性失效（id 理论不复用，但夹具/导入可能固定 id）。
 *
 * @module test/chat/message-content-decode-cache
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { bootstrapNovelMaster } from "@/bootstrap/novel-master-bootstrap.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { encodeMessageContent } from "@/domain/chat/logic/message-content-codec.js";
import { clearDecodedContentCaches } from "@/infra/content-cache/logic/decoded-content-cache.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 造一条可插入的可见消息。 */
function messageFixture(
  sessionId: string,
  seq: number,
  text: string
): ChatMessage {
  return {
    id: randomUUID(),
    sessionId,
    seq,
    role: seq % 2 === 0 ? "assistant" : "user",
    content: textBlocks(text),
    provider: null,
    raw: null,
    createdAtMs: Date.now() + seq,
    hidden: false,
  };
}

/** 把指定会话全部消息的正文 blob 换成解压必失败的字节。 */
async function corruptAllMessageBlobs(
  conn: { execute(sql: string, params?: readonly unknown[]): Promise<unknown> },
  sessionId: string
): Promise<void> {
  await conn.execute(
    `UPDATE chat_message SET content_blob = ?, content_encoding = 'zlib'
     WHERE session_id = ? AND content_blob IS NOT NULL`,
    [new Uint8Array([1, 2, 3]), sessionId]
  );
}

describe("chat_message 正文 × 进程内解压产物层", () => {
  it("同一会话二次读全走内存：blob 全部投毒仍读回原内容；清池后必抛（反向锁）", async () => {
    clearDecodedContentCaches();
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteMessageRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(
      project.id,
      `S-${testIsolationSuffix()}`
    );

    const messages = [
      messageFixture(session.id, 1, `第一条-${testIsolationSuffix()}`),
      messageFixture(session.id, 2, `第二条-${testIsolationSuffix()}`),
      messageFixture(session.id, 3, `第三条-${testIsolationSuffix()}`),
    ];
    for (const message of messages) {
      await repo.insert(message);
    }

    // 首读（进池）：可见消息读口，正是 chip 组装/转录展示走的那条
    const first = await repo.listBySession(session.id, { includeHidden: false });
    assert.deepEqual(
      first.map((m) => m.content),
      messages.map((m) => m.content)
    );

    await corruptAllMessageBlobs(ctx.conn, session.id);
    const second = await repo.listBySession(session.id, {
      includeHidden: false,
    });
    assert.deepEqual(
      second.map((m) => m.content),
      messages.map((m) => m.content),
      "整批正文来自内存层（blob 已全部投毒）"
    );

    // 反向锁：清池后再读必须撞上投毒（证明上一条不是巧合）
    clearDecodedContentCaches();
    await assert.rejects(() =>
      repo.listBySession(session.id, { includeHidden: false })
    );
  });

  it("updateContent 换正文后必须读到新内容（失效纪律的承重断言）", async () => {
    clearDecodedContentCaches();
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteMessageRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(
      project.id,
      `S-${testIsolationSuffix()}`
    );
    const message = messageFixture(session.id, 1, `旧正文-${testIsolationSuffix()}`);
    await repo.insert(message);

    // 读一次把旧正文放进池
    assert.deepEqual(
      (await repo.findById(message.id))!.content,
      message.content
    );

    const newContent = textBlocks(`新正文-${testIsolationSuffix()}`);
    assert.equal(await repo.updateContent(message.id, newContent), true);

    assert.deepEqual(
      (await repo.findById(message.id))!.content,
      newContent,
      "updateContent 未失效内存层 = 读到旧正文（本用例的牙齿）"
    );
  });

  it("整库替换（重新 bootstrap）后不再读到上一代库的正文", async () => {
    clearDecodedContentCaches();
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteMessageRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(
      project.id,
      `S-${testIsolationSuffix()}`
    );
    const message = messageFixture(session.id, 1, `甲-${testIsolationSuffix()}`);
    await repo.insert(message);
    assert.deepEqual(
      (await repo.findById(message.id))!.content,
      message.content
    );

    // 模拟「整库被替换」：同一 id 在库里换成另一份正文（备份导入 / 云同步
    // pull 的形态——库文件被覆盖，行 id 不变）。走裸 SQL 绕过 repository 的
    // 失效点，正是换库路径的真实形态。
    const replacement = encodeMessageContent(
      JSON.stringify(textBlocks("乙-来自上一代库"))
    );
    await ctx.conn.execute(
      `UPDATE chat_message SET content_json = '', content_encoding = ?, content_blob = ?
       WHERE id = ?`,
      [replacement.encoding, replacement.blob, message.id]
    );

    // 前置事实：没有重新 bootstrap 时内存层确实还压着旧正文（这就是要求
    // 「换库收口必须清池」的原因，见 bootstrapNovelMaster 头注释）。
    assert.deepEqual(
      (await repo.findById(message.id))!.content,
      message.content,
      "池热时不重引导会读到旧正文（换库必须清池的理由）"
    );

    // 换库收口：重新引导 → 池被清 → 读到库里那一代的正文
    await bootstrapNovelMaster(ctx.conn);
    assert.deepEqual(
      (await repo.findById(message.id))!.content,
      textBlocks("乙-来自上一代库"),
      "重新 bootstrap 后必须读到新库正文"
    );
  });

  it("删除后拿同一 id 重插新正文：读到新内容（insert/delete 的防御性失效）", async () => {
    clearDecodedContentCaches();
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteMessageRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(
      project.id,
      `S-${testIsolationSuffix()}`
    );

    // 固定 id（真实路径是 randomUUID，此处刻意验证不复用假设被打破时的兜底）
    const fixedId = randomUUID();
    const firstMessage: ChatMessage = {
      ...messageFixture(session.id, 1, `甲-${testIsolationSuffix()}`),
      id: fixedId,
    };
    await repo.insert(firstMessage);
    assert.deepEqual(
      (await repo.findById(fixedId))!.content,
      firstMessage.content
    );

    // 情形一：走 repository.delete（回滚/批量删的真实路径）→ delete 的失效兜住
    await repo.delete(fixedId);
    assert.equal(await repo.findById(fixedId), null);
    const secondContent = textBlocks(`乙-${testIsolationSuffix()}`);
    await repo.insert({...firstMessage, content: secondContent});
    assert.deepEqual(
      (await repo.findById(fixedId))!.content,
      secondContent,
      "同 id 重插新正文必须读到新值（delete 失效）"
    );

    // 情形二：行被 repository 之外的写方直接删掉（SQL/迁移/导入绕道），
    // 此时只有 insert 自己的防御性失效能救 —— 否则读到上一轮的缓存正文
    await ctx.conn.execute("DELETE FROM chat_message WHERE id = ?", [fixedId]);
    const thirdContent = textBlocks(`丙-${testIsolationSuffix()}`);
    await repo.insert({...firstMessage, content: thirdContent});
    assert.deepEqual(
      (await repo.findById(fixedId))!.content,
      thirdContent,
      "外部删行后同 id 重插也必须读到新值（insert 失效）"
    );
  });
});
