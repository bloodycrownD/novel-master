import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VfsError } from "@novel-master/core";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("ScopedVfsService", () => {
  it("isolates global template from project", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.globalVfs().write("/g.md", "global");
    const project = await ctx.projects.create("P");
    const pvfs = ctx.projectVfs(project.id);
    const projectPaths = await pvfs.list("/", { recursive: true });
    assert.equal(projectPaths.length, 0);
    await ctx.conn.close();
  });

  it("global list shows unified logical paths", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.globalVfs().write("/seed/hello.md", "hi");
    const paths = await ctx.globalVfs().list("/", { recursive: true });
    assert.ok(paths.some((e) => e.path === "/seed/hello.md"));
    assert.ok(!paths.some((e) => e.path.startsWith("/template/")));
    await ctx.conn.close();
  });

  it("T3: project write and read round-trip unified paths", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/prompts/system.md", "system prompt");
    const read = await pvfs.read("/prompts/system.md");
    assert.equal(read.content, "system prompt");
    assert.equal(read.path, "/prompts/system.md");
    await ctx.conn.close();
  });

  it("rejects legacy /template logical paths", async () => {
    const ctx = await openNovelMasterTestConnection();
    await assert.rejects(
      () => ctx.globalVfs().write("/template/legacy.md", "x"),
      (e: unknown) => {
        assert.ok(e instanceof VfsError);
        assert.equal(e.code, "INVALID_PATH");
        return true;
      },
    );
    await ctx.conn.close();
  });

  it("session paths invisible to project scope", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    await ctx.sessionVfs(project.id, session.id).write("/note.md", "n");
    await assert.rejects(() => ctx.projectVfs(project.id).read("/note.md"));
    await ctx.conn.close();
  });
});
