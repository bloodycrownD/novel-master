/**
 * MessageService.searchMessages 的 limit 防御性截断（ic-31 验收）。
 *
 * service 层在仓储精筛后做防御性重筛 + `slice(0, Math.max(1,
 * Math.floor(query.limit)))`：port 合同允许仓储实现退回「超集召回」
 * （如曾经的 SQL LIKE 粗筛，不截断 limit）。本用例用**超集假仓储**
 * （无视 query.limit、直接返回 10 条全命中）钉住「换 port 实现也不会
 * 把超量结果透传给 UI」——把 service 层的 slice 删掉时本用例必红。
 * 截断口径与仓储层 clampedLimit 一致（Math.max(1, Math.floor(limit))，
 * 规避负数/浮点）。
 *
 * @module test/service/chat/message-search-service-limit
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteSessionRepository } from "../../../src/domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteVfsEntryRepository } from "../../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteMessageCheckpointRepository } from "../../../src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsRevisionRepository } from "../../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { MessageRepository } from "../../../src/domain/chat/repositories/message.port.js";
import type { ChatMessage } from "../../../src/domain/chat/model/message.js";
import { DefaultMessageService } from "../../../src/service/chat/impl/message.service.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
} from "../../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 构造一条命中 "needle" 关键词的 user 消息（seq DESC 序）。 */
function hitMessage(i: number): ChatMessage {
  return {
    id: `superset-${i}`,
    sessionId: "s-superset",
    seq: 10 - i,
    role: "user",
    content: textBlocks(`needle 第 ${i} 条命中消息`),
    provider: null,
    raw: null,
    createdAtMs: 1_000 + i,
    hidden: false,
  };
}

/** 组一个 messages 为超集假仓储的 MessageService（其余 deps 走真实仓储）。 */
function serviceWithSupersetRepo(superset: readonly ChatMessage[]) {
  const ctx = getNovelMasterTestContext();
  const supersetMessagesRepo = {
    // 超集假仓储（ic-31 验收口径）：无视 query.limit，直接退回全部命中行
    // ——模拟「SQL 粗筛召回超集、不在仓储层截断」的 port 实现。只实现
    // searchMessages（其余方法不在本用例路径上，靠强转收窄形状）。
    searchMessages: async () => [...superset],
  } as unknown as MessageRepository;
  return new DefaultMessageService({
    conn: ctx.conn,
    sessions: new SqliteSessionRepository(ctx.conn),
    messages: supersetMessagesRepo,
    vfs: new SqliteVfsEntryRepository(ctx.conn),
    checkpoints: new SqliteMessageCheckpointRepository(ctx.conn),
    revisions: new SqliteVfsRevisionRepository(ctx.conn),
  });
}

describe("MessageService.searchMessages 超集防御（ic-31）", () => {
  it("超集假仓储返回 10 条命中、query.limit=5 → service 返回恰 5 条（slice 截断）", async () => {
    const superset = Array.from({ length: 10 }, (_, i) => hitMessage(i + 1));
    const svc = serviceWithSupersetRepo(superset);

    const result = await svc.searchMessages("s-superset", {
      keyword: "needle",
      limit: 5,
    });
    assert.ok(
      result.length <= 5,
      `换超集召回的 port 实现时不得超量返回（limit 失效），实际 ${result.length} 条`
    );
    assert.equal(result.length, 5, "恰返回 limit 条（10 条命中截到 5）");
    assert.deepEqual(
      result.map((m) => m.id),
      ["superset-1", "superset-2", "superset-3", "superset-4", "superset-5"],
      "slice 保序截前 limit 条（防御性重筛不重排）"
    );
    for (const msg of result) {
      assert.ok(msg.content.blocks[0]?.type === "text", "命中文本块原样透传");
    }
  });

  it("limit 非法值同口径：5.9 向下取整到 5、-3 钳到 1（与仓储层 clampedLimit 一致）", async () => {
    const superset = Array.from({ length: 10 }, (_, i) => hitMessage(i + 1));
    const svc = serviceWithSupersetRepo(superset);

    assert.equal(
      (await svc.searchMessages("s-superset", { keyword: "needle", limit: 5.9 }))
        .length,
      5,
      "浮点 limit 向下取整"
    );
    assert.equal(
      (await svc.searchMessages("s-superset", { keyword: "needle", limit: -3 }))
        .length,
      1,
      "负数 limit 钳到 1（Math.max(1, ...)）"
    );
  });
});
