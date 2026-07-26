/**
 * message-rollback-execution-redesign must-fix 测例：
 * T-RB-PARTIAL-WRITE / T-RB-SQL-ONCE / T-RB-STABLE-CP
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { RevisionAwareVfsService } from "@/service/vfs/impl/revision-aware-vfs.service.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("rollback execution redesign", () => {
  it("T-RB-PARTIAL-WRITE: 多文件仅 diff 路径实质 write", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const fileCount = 6;
    const diffCount = 2;

    const anchorAssistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "anchor" }],
    });
    for (let i = 0; i < fileCount; i++) {
      await svfs.write(`/partial-${i}.md`, `anchor-${i}`, {
        versionCheck: false,
      });
    }
    await ctx.messageCheckpoint.capture(
      session.id,
      project.id,
      anchorAssistant.id,
    );

    await ctx.messages.append(session.id, "user", textBlocks("tail"));
    const tailAssistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "tail" }],
    });
    for (let i = 0; i < diffCount; i++) {
      await svfs.write(`/partial-${i}.md`, `tail-${i}`, {
        versionCheck: false,
      });
    }
    await ctx.messageCheckpoint.capture(
      session.id,
      project.id,
      tailAssistant.id,
    );

    const writeSpy = mock.method(RevisionAwareVfsService.prototype, "write");
    try {
      await ctx.sessionFs.rollbackToMessage(
        session.id,
        project.id,
        anchorAssistant.id,
      );
    } finally {
      writeSpy.mock.restore();
    }

    assert.equal(writeSpy.mock.callCount(), diffCount);
    for (let i = 0; i < diffCount; i++) {
      assert.equal((await svfs.read(`/partial-${i}.md`)).content, `anchor-${i}`);
    }
    for (let i = diffCount; i < fileCount; i++) {
      assert.equal((await svfs.read(`/partial-${i}.md`)).content, `anchor-${i}`);
    }
  });

  it("T-RB-SQL-ONCE: 回滚热路径不走 listDistinct+Set+deleteExceptReachable", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const anchorAssistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "anchor" }],
    });
    await svfs.write("/sql-once.md", "v1", { versionCheck: false });
    await ctx.messageCheckpoint.capture(
      session.id,
      project.id,
      anchorAssistant.id,
    );

    const tailAssistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "tail" }],
    });
    await svfs.write("/sql-once.md", "v2", { versionCheck: false });
    await ctx.messageCheckpoint.capture(
      session.id,
      project.id,
      tailAssistant.id,
    );

    const listDistinctSpy = mock.method(
      SqliteMessageCheckpointRepository.prototype,
      "listDistinctCheckpointPointersForSession",
    );
    const deleteExceptSpy = mock.method(
      SqliteVfsRevisionRepository.prototype,
      "deleteExceptReachable",
    );
    const deleteUnrefSpy = mock.method(
      SqliteVfsRevisionRepository.prototype,
      "deleteUnreferencedUnderPrefix",
    );

    try {
      await ctx.sessionFs.rollbackToMessage(
        session.id,
        project.id,
        anchorAssistant.id,
      );
    } finally {
      listDistinctSpy.mock.restore();
      deleteExceptSpy.mock.restore();
      deleteUnrefSpy.mock.restore();
    }

    assert.equal(listDistinctSpy.mock.callCount(), 0);
    assert.equal(deleteExceptSpy.mock.callCount(), 0);
    assert.ok(deleteUnrefSpy.mock.callCount() >= 1);
  });

  it("T-RB-STABLE-CP: 截断后仍可回滚到更早保留 checkpoint，正文正确", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const checkpoints = new SqliteMessageCheckpointRepository(ctx.conn);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "cp1" }],
    });
    await svfs.write("/stable.md", "chapter-1", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    await ctx.messages.append(session.id, "user", textBlocks("2"));
    const assistant2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "cp2" }],
    });
    await svfs.write("/stable.md", "chapter-2", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant2.id);

    await ctx.messages.append(session.id, "user", textBlocks("3"));
    const assistant3 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "cp3" }],
    });
    await svfs.write("/stable.md", "chapter-3", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant3.id);

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant2.id,
    );
    assert.equal((await svfs.read("/stable.md")).content, "chapter-2");
    assert.equal((await ctx.messages.listBySession(session.id)).length, 4);
    assert.ok(await checkpoints.hasCheckpoint(session.id, assistant1.id));
    assert.ok(await checkpoints.hasCheckpoint(session.id, assistant2.id));
    assert.equal(await checkpoints.hasCheckpoint(session.id, assistant3.id), false);

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
    );
    assert.equal((await svfs.read("/stable.md")).content, "chapter-1");
    assert.equal((await ctx.messages.listBySession(session.id)).length, 2);
    assert.ok(await checkpoints.hasCheckpoint(session.id, assistant1.id));
    assert.equal(await checkpoints.hasCheckpoint(session.id, assistant2.id), false);
  });
});
