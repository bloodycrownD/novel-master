import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TdbcConnection } from "@novel-master/core";
import { SqliteSessionExecuteRepository } from "@/domain/session-fs/repositories/impl/sqlite-execute.repository.js";
import { SqliteSessionSnapshotRepository } from "@/domain/session-fs/repositories/impl/sqlite-snapshot.repository.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

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
    await pvfs.write("/template/a.md", "A");
    await pvfs.write("/template/sub/b.md", "B");

    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const paths = await svfs.list("/", { recursive: true });
    assert.deepEqual(paths.sort(), ["/a.md", "/sub/b.md"]);
    assert.equal((await svfs.read("/a.md")).content, "A");
    await ctx.conn.close();
  });

  it("project template changes after session create do not affect session vfs", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/template/a.md", "A");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await pvfs.write("/template/a.md", "CHANGED", { versionCheck: false });
    await pvfs.write("/template/new.md", "NEW");

    assert.equal((await svfs.read("/a.md")).content, "A");
    const paths = await svfs.list("/", { recursive: true });
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

  it("message append preserves seq order", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    await ctx.messages.append(session.id, "user", { content: "hi" });
    await ctx.messages.append(session.id, "assistant", { content: "hey" });
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
    const m1 = await ctx.messages.append(session.id, "user", { content: "1" });
    const m2 = await ctx.messages.append(session.id, "user", { content: "2" });
    await ctx.messages.append(session.id, "user", { content: "3" });

    const forked = await ctx.messages.fork(session.id, m2.id);
    const forkedMsgs = await ctx.messages.listBySession(forked.id);
    assert.equal(forkedMsgs.length, 2);
    assert.equal(forkedMsgs[0]!.content.content, "1");
    assert.equal(forkedMsgs[1]!.content.content, "2");
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
    const m1 = await ctx.messages.append(session.id, "user", { content: "1" });
    const m2 = await ctx.messages.append(session.id, "user", { content: "2" });
    await ctx.messages.append(session.id, "user", { content: "3" });

    const forked = await ctx.messages.fork(session.id, m2.id);
    await ctx.messages.append(forked.id, "user", { content: "fork-only" });

    const sourceMsgs = await ctx.messages.listBySession(session.id);
    assert.equal(sourceMsgs.length, 3);
    assert.equal(sourceMsgs[2]!.content.content, "3");

    const forkedMsgs = await ctx.messages.listBySession(forked.id);
    assert.equal(forkedMsgs.length, 3);
    assert.equal(forkedMsgs[0]!.content.content, "1");
    assert.equal(forkedMsgs[1]!.content.content, "2");
    assert.equal(forkedMsgs[2]!.content.content, "fork-only");
    assert.notEqual(forkedMsgs[0]!.id, m1.id);
    await ctx.conn.close();
  });

  it("session copy duplicates vfs and messages", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/note.md", "body");
    await ctx.messages.append(session.id, "user", { content: "hi" });
    await ctx.messages.append(session.id, "assistant", { content: "hey" });

    const copy = await ctx.sessions.copy(session.id);
    const copyVfs = ctx.sessionVfs(project.id, copy.id);
    assert.equal((await copyVfs.read("/note.md")).content, "body");
    const copyMsgs = await ctx.messages.listBySession(copy.id);
    assert.equal(copyMsgs.length, 2);
    assert.equal(copyMsgs[0]!.content.content, "hi");
    assert.equal(copyMsgs[1]!.content.content, "hey");
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

  it("project copy copies template only", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    await ctx.projectVfs(project.id).write("/template/foo.md", "FOO");
    await ctx.sessions.create(project.id);

    const copy = await ctx.projects.copy(project.id);
    assert.equal(
      (await ctx.projectVfs(copy.id).read("/template/foo.md")).content,
      "FOO",
    );
    assert.equal((await ctx.sessions.listByProject(copy.id)).length, 0);
    await ctx.conn.close();
  });
});
