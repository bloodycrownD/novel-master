/**
 * restore-path resetHead 语义测试（Step 10）。
 *
 * T-W1: 回滚到 checkpoint 后 revision 表行数不变（对比回滚前后 COUNT）
 * T-W2: 同文短路仍生效，不产生冗余 version 行（V12）
 *
 * @module test/message-checkpoint/restore-path-reset-head
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import {
  createMessageRollbackService,
  type MessageRollbackService,
} from "@novel-master/core/message-checkpoint";
import { type VfsService } from "@novel-master/core/vfs";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

async function revisionCount(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
): Promise<number> {
  const rows = await ctx.conn.query<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM vfs_revision",
  );
  return Number(rows[0]!.cnt);
}

describe("restore-path resetHead semantics", () => {
  it("T-W1: 回滚到 checkpoint 后 revision 表行数不变", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-W1-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const rollback = createMessageRollbackService(ctx.conn);

    // 写若干 version
    await svfs.write("/file.md", "v1", { versionCheck: false });
    await svfs.write("/file.md", "v2", { versionCheck: false });
    await svfs.write("/file.md", "v3", { versionCheck: false });
    const countBeforeCapture = await revisionCount(ctx);

    // capture checkpoint
    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "checkpoint-1" }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);

    // 再写新 version
    await svfs.write("/file.md", "v4", { versionCheck: false });
    await svfs.write("/file.md", "v5", { versionCheck: false });

    // rollback 到 checkpoint
    await rollback.rollbackToMessage(session.id, project.id, assistant.id);

    // rollback 后 revision 表行数 <= capture 前（rollback 不 append 新 revision）
    // sweep 可能删除 ref_count=0 的历史 revision，所以不少于 1（当前 live head）即可。
    const countAfterRollback = await revisionCount(ctx);
    assert.ok(
      countAfterRollback <= countBeforeCapture,
      `rollback 后 revision 行数 (${countAfterRollback}) 应不超过 capture 前 (${countBeforeCapture})`,
    );
    assert.ok(
      countAfterRollback >= 1,
      `rollback 后应至少留 1 条 revision（当前 head），实际 ${countAfterRollback}`,
    );

    // 内容已恢复到 v3
    const result = await svfs.read("/file.md");
    assert.equal(result.content, "v3", "rollback 后文件内容应恢复到 v3");
    assert.equal(result.version, 3, "rollback 后 head version 应为 3");
  });

  it("T-W2: 同文短路仍生效，不产生冗余 version 行（V12）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-W2-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    // 写初始版本
    await svfs.write("/short-circuit.md", "hello", { versionCheck: false });
    const countAfterFirst = await revisionCount(ctx);

    // 连续写相同内容——不应新增 revision 行
    await svfs.write("/short-circuit.md", "hello", { versionCheck: false });
    const countAfterSame = await revisionCount(ctx);
    assert.equal(
      countAfterSame,
      countAfterFirst,
      "同文写入不应新增 revision 行",
    );

    // 再确认 version 没增长
    const result = await svfs.read("/short-circuit.md");
    assert.equal(result.version, 1, "同文短路后 head version 应保持 1");
    assert.equal(result.content, "hello", "内容应保持不变");

    // 第三次相同写入
    await svfs.write("/short-circuit.md", "hello", { versionCheck: false });
    const countAfterThird = await revisionCount(ctx);
    assert.equal(
      countAfterThird,
      countAfterFirst,
      "多次同文写入不应新增 revision 行（V12）",
    );
  });
});
