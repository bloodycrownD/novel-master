/**
 * baseline checkpoint backfill 操作的 detect → repair 端到端测试（S-8 / Step 20）。
 *
 * 验证把 {@link backfillBaselineCheckpoints} 包成 {@link IntegrityRepairOperation} 后：
 * - 空会话 / 没 live 文件时 detect 返回 needsRepair=false；
 * - 有空窗消息时 detect 返回 needsRepair=true；
 * - repair 真补上 baseline checkpoint；
 * - 补完后再 detect 返回 needsRepair=false（幂等）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { createBaselineCheckpointBackfillOperation } from "@/domain/message-checkpoint/logic/backfill-baseline-checkpoints.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("rollback-backfill-baseline-op: createBaselineCheckpointBackfillOperation", () => {
  it("空会话（无消息）detect 返回 needsRepair=false", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-op-empty-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const op = createBaselineCheckpointBackfillOperation({
      entryRepo: new SqliteVfsEntryRepository(ctx.conn),
      messageRepo: new SqliteMessageRepository(ctx.conn),
      checkpointRepo: new SqliteMessageCheckpointRepository(ctx.conn),
      projectId: project.id,
      sessionId: session.id,
    });

    const detection = await op.detect();
    assert.equal(detection.needsRepair, false);
  });

  it("有空窗消息时 detect=true，repair 补齐后再 detect=false", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-op-gap-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    // 模拟 Step 9 之前的旧会话：写文件 + 写消息，全程不 capture → 所有消息都是空窗
    await svfs.write("/anchor.md", "at-send", { versionCheck: false });
    await ctx.messages.append(session.id, "user", textBlocks("anchor"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "hi" }],
    });

    const op = createBaselineCheckpointBackfillOperation({
      entryRepo: new SqliteVfsEntryRepository(ctx.conn),
      messageRepo: new SqliteMessageRepository(ctx.conn),
      checkpointRepo: new SqliteMessageCheckpointRepository(ctx.conn),
      projectId: project.id,
      sessionId: session.id,
    });

    const before = await op.detect();
    assert.equal(before.needsRepair, true, "有空窗消息时应标记需修复");

    await op.repair();

    const after = await op.detect();
    assert.equal(after.needsRepair, false, "补齐 baseline 后应不再需要修复");
  });
});
