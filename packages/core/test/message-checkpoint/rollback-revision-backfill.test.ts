import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import {
  isRollbackRevisionBackfillRequiredError,
} from "@novel-master/core/session-fs";
import { toPhysicalPath } from "@novel-master/core/vfs";
import { backfillMissingRevisionIfNeeded } from "../../src/domain/message-checkpoint/logic/backfill-missing-revision.js";
import { SqliteVfsEntryRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 双 checkpoint 场景：回滚到第一个 assistant anchor。 */
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

async function deleteAnchorRevisionForPath(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
  projectId: string,
  sessionId: string,
  logicalPath: string,
) {
  const physicalPath = toPhysicalPath(
    { kind: "session", projectId, sessionId },
    logicalPath,
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
  return anchorVersion;
}

describe("MessageRollbackService (revision head backfill)", () => {
  it("RB1: 多文件 partial reconcile — A 精确恢复，B 保持现状", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("go"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "write" }],
    });
    await svfs.write("/a.md", "anchor-a", { versionCheck: false });
    await svfs.write("/b.md", "anchor-b", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    await ctx.messages.append(session.id, "user", textBlocks("more"));
    const assistant2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "later" }],
    });
    await svfs.write("/a.md", "tail-a", { versionCheck: false });
    await svfs.write("/b.md", "tail-b", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant2.id);

    await deleteAnchorRevisionForPath(ctx, project.id, session.id, "/b.md");

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
      { revisionHeadBackfill: true },
    );

    assert.equal((await svfs.read("/a.md")).content, "anchor-a");
    assert.equal((await svfs.read("/b.md")).content, "tail-b");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.id, user1.id);
    assert.equal(messages[1]!.id, assistant1.id);
  });

  it("RB2: 单文件 anchor revision 缺失 — revisionHeadBackfill 成功，内容不变", async () => {
    const { ctx, project, session, svfs, user1, assistant1 } =
      await setupR1Scenario();

    await deleteAnchorRevisionForPath(ctx, project.id, session.id, "/poem.md");

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

  it("RB3: 所有 revision 完好 — 与 R1 一致精确恢复", async () => {
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

  it("RB5: revision 已存在时不重复 append", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

    await svfs.write("/exists.md", "content", { versionCheck: false });
    const physical = toPhysicalPath(scope, "/exists.md");
    const before = await ctx.conn.query<{ version: number }>(
      "SELECT version FROM vfs_revision WHERE path = ?",
      [physical],
    );

    const backfilled = await backfillMissingRevisionIfNeeded(
      { revisionRepo: revisions, entryRepo: entries },
      physical,
      1,
    );

    assert.equal(backfilled, false);
    const after = await ctx.conn.query<{ version: number }>(
      "SELECT version FROM vfs_revision WHERE path = ?",
      [physical],
    );
    assert.equal(after.length, before.length);
  });

  it("skipVfsReconcile 与 revisionHeadBackfill 同时指定时抛错", async () => {
    const { ctx, project, session, assistant1 } = await setupR1Scenario();

    await assert.rejects(
      () =>
        ctx.sessionFs.rollbackToMessage(
          session.id,
          project.id,
          assistant1.id,
          { skipVfsReconcile: true, revisionHeadBackfill: true },
        ),
      /skipVfsReconcile 与 revisionHeadBackfill 不能同时指定/,
    );
  });

  it("revision 缺失且未确认回补时抛 ROLLBACK_REVISION_BACKFILL_REQUIRED", async () => {
    const { ctx, project, session, assistant1 } = await setupR1Scenario();

    await deleteAnchorRevisionForPath(ctx, project.id, session.id, "/poem.md");

    await assert.rejects(
      () =>
        ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id),
      (error: unknown) => {
        assert.equal(isRollbackRevisionBackfillRequiredError(error), true);
        const err = error as { missingLogicalPaths?: readonly string[] };
        assert.deepEqual(err.missingLogicalPaths, ["/poem.md"]);
        return true;
      },
    );
  });
});
