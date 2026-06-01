import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageContent, TdbcConnection } from "@novel-master/core";
import { textBlocks } from "@novel-master/core";
import { SqliteSessionExecuteRepository } from "@/domain/session-fs/repositories/impl/sqlite-execute.repository.js";
import { SqliteSessionSnapshotRepository } from "@/domain/session-fs/repositories/impl/sqlite-snapshot.repository.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

function firstTextBlock(content: MessageContent): string {
  const block = content.blocks[0];
  assert.equal(block?.type, "text");
  return block!.type === "text" ? block.text : "";
}

async function assertNoSessionFsData(
  conn: TdbcConnection,
  sessionId: string,
): Promise<void> {
  const execute = new SqliteSessionExecuteRepository(conn);
  const snapshots = new SqliteSessionSnapshotRepository(conn);
  assert.equal((await execute.listBatches(sessionId)).length, 0);
  assert.equal((await snapshots.listByPath(sessionId, "/purge.md")).length, 0);
}

describe("Chat services", () => {
  it("session create copies project template to session vfs", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/a.md", "A");
    await pvfs.write("/sub/b.md", "B");

    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const paths = (await svfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path);
    assert.deepEqual(paths.sort(), ["/a.md", "/sub/b.md"]);
    assert.equal((await svfs.read("/a.md")).content, "A");
    await ctx.conn.close();
  });

  it("project template changes after session create do not affect session vfs", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/a.md", "A");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await pvfs.write("/a.md", "CHANGED", { versionCheck: false });
    await pvfs.write("/new.md", "NEW");

    assert.equal((await svfs.read("/a.md")).content, "A");
    const paths = (await svfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path);
    assert.deepEqual(paths.sort(), ["/a.md"]);
    await ctx.conn.close();
  });

  it("empty template yields empty session vfs", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("Empty");
    const session = await ctx.sessions.create(project.id);
    const paths = await ctx.sessionVfs(project.id, session.id).list("/");
    assert.deepEqual(paths, []);
    await ctx.conn.close();
  });

  it("project rename updates name and updatedAtMs", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("Old Name");
    const renamed = await ctx.projects.rename(project.id, "New Name");
    assert.equal(renamed.name, "New Name");
    assert.ok(renamed.updatedAtMs >= project.updatedAtMs);
    const loaded = await ctx.projects.get(project.id);
    assert.equal(loaded.name, "New Name");
    await ctx.conn.close();
  });

  it("project rename rejects empty name", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    await assert.rejects(
      () => ctx.projects.rename(project.id, "   "),
      (err: unknown) =>
        err instanceof Error && err.message.includes("must not be empty"),
    );
    await ctx.conn.close();
  });

  it("project create rejects empty name", async () => {
    const ctx = await openNovelMasterTestConnection();
    await assert.rejects(
      () => ctx.projects.create("  "),
      (err: unknown) =>
        err instanceof Error && err.message.includes("must not be empty"),
    );
    await ctx.conn.close();
  });

  it("message delete removes row", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const m = await ctx.messages.append(session.id, "user", textBlocks("hi"));
    await ctx.messages.delete(m.id);
    const list = await ctx.messages.listBySession(session.id);
    assert.equal(list.length, 0);
    await ctx.conn.close();
  });

  it("message updateContent replaces text", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const m = await ctx.messages.append(session.id, "user", textBlocks("hi"));
    const updated = await ctx.messages.updateContent(
      m.id,
      textBlocks("edited"),
    );
    assert.equal(firstTextBlock(updated.content), "edited");
    const loaded = await ctx.messages.get(m.id);
    assert.equal(firstTextBlock(loaded.content), "edited");
    await ctx.conn.close();
  });

  it("message append preserves seq order", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    await ctx.messages.append(session.id, "user", textBlocks("hi"));
    await ctx.messages.append(session.id, "assistant", textBlocks("hey"));
    const list = await ctx.messages.listBySession(session.id);
    assert.equal(list.length, 2);
    assert.equal(list[0]!.seq, 1);
    assert.equal(list[1]!.seq, 2);
    await ctx.conn.close();
  });

  it("message fork copies vfs and messages up to id", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/note.md", "edited");
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    const m2 = await ctx.messages.append(session.id, "user", textBlocks("2"));
    await ctx.messages.append(session.id, "user", textBlocks("3"));

    const forked = await ctx.messages.fork(session.id, m2.id);
    const forkedMsgs = await ctx.messages.listBySession(forked.id);
    assert.equal(forkedMsgs.length, 2);
    assert.equal(firstTextBlock(forkedMsgs[0]!.content), "1");
    assert.equal(firstTextBlock(forkedMsgs[1]!.content), "2");
    assert.equal(
      (await ctx.sessionVfs(project.id, forked.id).read("/note.md")).content,
      "edited",
    );
    assert.equal((await ctx.messages.listBySession(session.id)).length, 3);
    await ctx.conn.close();
  });

  it("message fork then append on forked session does not affect source", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    const m2 = await ctx.messages.append(session.id, "user", textBlocks("2"));
    await ctx.messages.append(session.id, "user", textBlocks("3"));

    const forked = await ctx.messages.fork(session.id, m2.id);
    await ctx.messages.append(forked.id, "user", textBlocks("fork-only"));

    const sourceMsgs = await ctx.messages.listBySession(session.id);
    assert.equal(sourceMsgs.length, 3);
    assert.equal(firstTextBlock(sourceMsgs[2]!.content), "3");

    const forkedMsgs = await ctx.messages.listBySession(forked.id);
    assert.equal(forkedMsgs.length, 3);
    assert.equal(firstTextBlock(forkedMsgs[0]!.content), "1");
    assert.equal(firstTextBlock(forkedMsgs[1]!.content), "2");
    assert.equal(firstTextBlock(forkedMsgs[2]!.content), "fork-only");
    assert.notEqual(forkedMsgs[0]!.id, m1.id);
    await ctx.conn.close();
  });

  it("session copy duplicates vfs and messages", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/note.md", "body");
    await ctx.messages.append(session.id, "user", textBlocks("hi"));
    await ctx.messages.append(session.id, "assistant", textBlocks("hey"));

    const copy = await ctx.sessions.copy(session.id);
    const copyVfs = ctx.sessionVfs(project.id, copy.id);
    assert.equal((await copyVfs.read("/note.md")).content, "body");
    const copyMsgs = await ctx.messages.listBySession(copy.id);
    assert.equal(copyMsgs.length, 2);
    assert.equal(firstTextBlock(copyMsgs[0]!.content), "hi");
    assert.equal(firstTextBlock(copyMsgs[1]!.content), "hey");
    assert.notEqual(copyMsgs[0]!.id, (await ctx.messages.listBySession(session.id))[0]!.id);

    await svfs.write("/note.md", "mutated", { versionCheck: false });
    assert.equal((await copyVfs.read("/note.md")).content, "body");
    await ctx.conn.close();
  });

  it("session delete purges session-fs rows in transaction", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    await ctx.sessionFs.execute(
      session.id,
      project.id,
      [{ function: "write", path: "/purge.md", content: "x" }],
      "user",
    );
    assert.equal(
      (await new SqliteSessionExecuteRepository(ctx.conn).listBatches(session.id))
        .length,
      1,
    );

    await ctx.sessions.delete(session.id);
    await assertNoSessionFsData(ctx.conn, session.id);
    await ctx.conn.close();
  });

  it("project delete purges session-fs for all sessions", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const s1 = await ctx.sessions.create(project.id);
    const s2 = await ctx.sessions.create(project.id);
    for (const session of [s1, s2]) {
      await ctx.sessionFs.execute(
        session.id,
        project.id,
        [{ function: "write", path: "/purge.md", content: "x" }],
        "user",
      );
    }

    await ctx.projects.delete(project.id);
    await assertNoSessionFsData(ctx.conn, s1.id);
    await assertNoSessionFsData(ctx.conn, s2.id);
    await ctx.conn.close();
  });

  it("session rename updates title", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id, "旧名");
    const renamed = await ctx.sessions.rename(session.id, "新名");
    assert.equal(renamed.title, "新名");
    const loaded = await ctx.sessions.get(session.id);
    assert.equal(loaded.title, "新名");
    await ctx.conn.close();
  });

  it("project copy copies template only", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    await ctx.projectVfs(project.id).write("/foo.md", "FOO");
    await ctx.sessions.create(project.id);

    const copy = await ctx.projects.copy(project.id);
    assert.equal(
      (await ctx.projectVfs(copy.id).read("/foo.md")).content,
      "FOO",
    );
    assert.equal((await ctx.sessions.listByProject(copy.id)).length, 0);
    await ctx.conn.close();
  });
});
