import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import {
  isRollbackRevisionBackfillRequiredError,
  isRollbackVfsDegradableError,
  isSessionFsError,
  SessionFsError,
  sessionFsRollbackMessageNotFound,
  sessionFsRollbackVfsRestoreFailed,
} from "@novel-master/core/session-fs";
import { toPhysicalPath } from "@novel-master/core/vfs";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** R1 场景：双 checkpoint，回滚到第一个 assistant anchor。 */
async function setupR1Scenario() {
  const ctx = getNovelMasterTestContext();
  const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
  const session = await ctx.sessions.create(project.id);
  const svfs = ctx.sessionVfs(project.id, session.id);

  const user1 = await ctx.messages.append(session.id, "user", textBlocks("poem"));
  const assistant1 = await ctx.messages.append(session.id, "assistant", {
    blocks: [{ type: "text", text: "here" }],
  });
  await svfs.write("/poem.md", "roses", { versionCheck: false });
  await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

  await ctx.messages.append(session.id, "user", textBlocks("more"));
  const assistant2 = await ctx.messages.append(session.id, "assistant", {
    blocks: [{ type: "text", text: "later" }],
  });
  await svfs.write("/poem.md", "violets", { versionCheck: false });
  await ctx.messageCheckpoint.capture(session.id, project.id, assistant2.id);

  return { ctx, project, session, svfs, user1, assistant1, assistant2 };
}

describe("MessageRollbackService (degraded fallback)", () => {
  it("DF1: revision 缺失时完整回滚抛 ROLLBACK_REVISION_BACKFILL_REQUIRED，消息与 VFS 不变", async () => {
    const { ctx, project, session, svfs, assistant1 } = await setupR1Scenario();

    const physicalPath = toPhysicalPath(
      { kind: "session", projectId: project.id, sessionId: session.id },
      "/poem.md",
    );
    const revisions = await ctx.conn.query<{ version: number }>(
      "SELECT version FROM vfs_revision WHERE path = ? ORDER BY version ASC",
      [physicalPath],
    );
    const anchorVersion = revisions[0]!.version;
    await ctx.conn.execute(
      "DELETE FROM vfs_revision WHERE path = ? AND version = ?",
      [physicalPath, anchorVersion],
    );

    await assert.rejects(
      () =>
        ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id),
      (error: unknown) => {
        assert.equal(isRollbackRevisionBackfillRequiredError(error), true);
        assert.equal(isRollbackVfsDegradableError(error), false);
        assert.equal(
          isSessionFsError(error, "ROLLBACK_REVISION_BACKFILL_REQUIRED"),
          true,
        );
        assert.match((error as Error).message, /回滚所需 revision 缺失/);
        return true;
      },
    );

    assert.equal((await svfs.read("/poem.md")).content, "violets");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 4);
  });

  it("DF1b: revision 缺失时 revisionHeadBackfill 回滚成功，缺失 path 保持现状", async () => {
    const { ctx, project, session, svfs, user1, assistant1 } =
      await setupR1Scenario();

    const physicalPath = toPhysicalPath(
      { kind: "session", projectId: project.id, sessionId: session.id },
      "/poem.md",
    );
    const revisions = await ctx.conn.query<{ version: number }>(
      "SELECT version FROM vfs_revision WHERE path = ? ORDER BY version ASC",
      [physicalPath],
    );
    await ctx.conn.execute(
      "DELETE FROM vfs_revision WHERE path = ? AND version = ?",
      [physicalPath, revisions[0]!.version],
    );

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
      { revisionHeadBackfill: true },
    );

    assert.equal((await svfs.read("/poem.md")).content, "violets");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.id, user1.id);
    assert.equal(messages[1]!.id, assistant1.id);
  });

  it("DF2: DF1 场景后 skipVfsReconcile 仅截断 tail，VFS 不变", async () => {
    const { ctx, project, session, svfs, user1, assistant1 } =
      await setupR1Scenario();

    const physicalPath = toPhysicalPath(
      { kind: "session", projectId: project.id, sessionId: session.id },
      "/poem.md",
    );
    const revisions = await ctx.conn.query<{ version: number }>(
      "SELECT version FROM vfs_revision WHERE path = ? ORDER BY version ASC",
      [physicalPath],
    );
    await ctx.conn.execute(
      "DELETE FROM vfs_revision WHERE path = ? AND version = ?",
      [physicalPath, revisions[0]!.version],
    );

    await assert.rejects(() =>
      ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id),
    );

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
      { skipVfsReconcile: true },
    );

    assert.equal((await svfs.read("/poem.md")).content, "violets");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.id, user1.id);
    assert.equal(messages[1]!.id, assistant1.id);
  });

  it("DF3: 完整回滚成功回归（R1 场景）", async () => {
    const { ctx, project, session, svfs, user1, assistant1 } =
      await setupR1Scenario();

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
    );

    assert.equal((await svfs.read("/poem.md")).content, "roses");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.id, user1.id);
    assert.equal(messages[1]!.id, assistant1.id);
  });

  it("DF4: R9 无 checkpoint anchor 完整回滚成功，不抛 degradable", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "mutate" }],
    });
    await svfs.write("/state.md", "v1", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    const textOnly = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "no tools" }],
    });
    await svfs.write("/state.md", "v2", { versionCheck: false });

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, textOnly.id);

    assert.equal((await svfs.read("/state.md")).content, "v1");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1]!.id, textOnly.id);
  });

  it("DF5: ROLLBACK_MESSAGE_NOT_FOUND 不包装为 degradable", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await assert.rejects(
      () =>
        ctx.sessionFs.rollbackToMessage(
          session.id,
          project.id,
          "missing-message-id",
        ),
      (error: unknown) => {
        assert.equal(isSessionFsError(error, "ROLLBACK_MESSAGE_NOT_FOUND"), true);
        assert.equal(isRollbackVfsDegradableError(error), false);
        return true;
      },
    );
  });

  it("DF6: isRollbackVfsDegradableError 边界", () => {
    assert.equal(
      isRollbackVfsDegradableError(
        sessionFsRollbackVfsRestoreFailed("工作区无法恢复：测试"),
      ),
      true,
    );
    assert.equal(
      isRollbackVfsDegradableError(
        new SessionFsError("RESTORE_REVISION_MISSING", "revision missing"),
      ),
      false,
    );
    assert.equal(
      isRollbackVfsDegradableError(
        sessionFsRollbackMessageNotFound("msg-1"),
      ),
      false,
    );
    assert.equal(isRollbackVfsDegradableError(new Error("generic")), false);
    assert.equal(isRollbackVfsDegradableError(null), false);
    assert.equal(isRollbackVfsDegradableError(undefined), false);
  });

  it("DF-U1: undo_send + skipVfsReconcile 删除锚点且 VFS 不变", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/keep.md", "stable", { versionCheck: false });
    const user1 = await ctx.messages.append(session.id, "user", textBlocks("anchor"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "reply" }],
    });
    await svfs.write("/keep.md", "mutated", { versionCheck: false });

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id, {
      skipVfsReconcile: true,
    });

    assert.equal((await svfs.read("/keep.md")).content, "mutated");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 0);
  });

  it("DF-U2: undo_send + revisionHeadBackfill 成功含锚点删除并对齐 prior VFS", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/state.md", "baseline", { versionCheck: false });
    const priorAsst = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "setup" }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, priorAsst.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("prompt"));
    const asst1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "reply" }],
    });
    await svfs.write("/state.md", "after-user1", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, asst1.id);
    await ctx.messages.append(session.id, "user", textBlocks("tail"));

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id, {
      revisionHeadBackfill: true,
    });

    assert.equal((await svfs.read("/state.md")).content, "baseline");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.id, priorAsst.id);
  });

  it("DF-U3: rewind + skipVfsReconcile 保留 assistant 锚点（非回归）", async () => {
    const { ctx, project, session, svfs, user1, assistant1 } =
      await setupR1Scenario();

    const physicalPath = toPhysicalPath(
      { kind: "session", projectId: project.id, sessionId: session.id },
      "/poem.md",
    );
    const revisions = await ctx.conn.query<{ version: number }>(
      "SELECT version FROM vfs_revision WHERE path = ? ORDER BY version ASC",
      [physicalPath],
    );
    await ctx.conn.execute(
      "DELETE FROM vfs_revision WHERE path = ? AND version = ?",
      [physicalPath, revisions[0]!.version],
    );

    await assert.rejects(() =>
      ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id),
    );

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
      { skipVfsReconcile: true },
    );

    assert.equal((await svfs.read("/poem.md")).content, "violets");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.id, user1.id);
    assert.equal(messages[1]!.id, assistant1.id);
  });
});
