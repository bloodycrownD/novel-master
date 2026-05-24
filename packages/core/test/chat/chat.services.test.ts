import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

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
