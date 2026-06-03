import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSessionFsError,
  textBlocks,
} from "@novel-master/core";
import { SqliteSessionExecuteRepository } from "../../src/domain/session-fs/repositories/impl/sqlite-execute.repository.js";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("rollbackToMessage", () => {
  it("assistant anchor keeps that round write and rolls back later batches", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("poem"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "here" }],
    });
    await ctx.sessionFs.execute(
      session.id,
      project.id,
      [{ function: "write", path: "/poem.md", content: "roses" }],
      "assistant",
      { messageId: assistant1.id },
    );
    await ctx.messages.append(session.id, "user", textBlocks("more"));
    const assistant2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "later" }],
    });
    await ctx.sessionFs.execute(
      session.id,
      project.id,
      [{ function: "write", path: "/poem.md", content: "violets" }],
      "assistant",
      { messageId: assistant2.id },
    );

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

    await ctx.conn.close();
  });

  it("user anchor removes later assistant batch and truncates messages", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("write poem"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "ok" }],
    });
    await ctx.sessionFs.execute(
      session.id,
      project.id,
      [{ function: "write", path: "/poem.md", content: "draft" }],
      "assistant",
      { messageId: assistant1.id },
    );
    await ctx.messages.append(session.id, "user", textBlocks("nice"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "thanks" }],
    });

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id);

    await assert.rejects(() => svfs.read("/poem.md"));
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.id, user1.id);

    await ctx.conn.close();
  });

  it("text-only tail truncates messages without vfs changes", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/keep.md", "stable", { versionCheck: false });

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("hi"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "hello" }],
    });
    await ctx.messages.append(session.id, "user", textBlocks("bye"));

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id);

    assert.equal((await svfs.read("/keep.md")).content, "stable");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 1);

    await ctx.conn.close();
  });

  it("rejects legacy mutating batch after anchor", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("a"));
    const legacy = await ctx.sessionFs.execute(
      session.id,
      project.id,
      [{ function: "write", path: "/legacy.md", content: "old" }],
      "assistant",
    );
    await ctx.conn.execute(
      `UPDATE session_execute_batch SET created_at_ms = ? WHERE id = ?`,
      [user1.createdAtMs + 10_000, legacy.batchId],
    );
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "b" }],
    });

    await assert.rejects(
      () =>
        ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id),
      (err: unknown) => {
        assert.ok(isSessionFsError(err, "ROLLBACK_LEGACY_BATCH"));
        return true;
      },
    );

    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
    assert.equal((await svfs.read("/legacy.md")).content, "old");

    await ctx.conn.close();
  });

  it("fails when checkpoint snapshot is missing", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("a"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "w" }],
    });
    const batch = await ctx.sessionFs.execute(
      session.id,
      project.id,
      [{ function: "write", path: "/gone.md", content: "x" }],
      "assistant",
      { messageId: assistant1.id },
    );
    await ctx.messages.append(session.id, "user", textBlocks("tail"));

    await ctx.conn.execute(
      `DELETE FROM session_vfs_snapshot WHERE session_id = ?`,
      [session.id],
    );

    await assert.rejects(
      () =>
        ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id),
      (err: unknown) => {
        assert.ok(isSessionFsError(err, "ROLLBACK_SNAPSHOT_MISSING"));
        return true;
      },
    );

    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 3);
    const execute = new SqliteSessionExecuteRepository(ctx.conn);
    assert.notEqual(await execute.findBatch(batch.batchId), null);

    await ctx.conn.close();
  });

  it("deleteAfterSeq removes only higher seq", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    await ctx.messages.append(session.id, "user", textBlocks("2"));
    await ctx.messages.append(session.id, "user", textBlocks("3"));

    const repo = new SqliteMessageRepository(ctx.conn);
    await repo.deleteAfterSeq(session.id, m1.seq);

    const left = await ctx.messages.listBySession(session.id);
    assert.equal(left.length, 1);
    assert.equal(left[0]!.id, m1.id);

    await ctx.conn.close();
  });
});
