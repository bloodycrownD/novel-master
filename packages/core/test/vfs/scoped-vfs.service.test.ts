import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VfsError } from "@novel-master/core";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("ScopedVfsService", () => {
  it("isolates global template from project", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.globalVfs().write("/template/g.md", "global");
    const project = await ctx.projects.create("P");
    const pvfs = ctx.projectVfs(project.id);
    const projectPaths = await pvfs.list("/template", { recursive: true });
    assert.equal(projectPaths.length, 0);
    await ctx.conn.close();
  });

  it("rejects non-template paths in global scope", async () => {
    const ctx = await openNovelMasterTestConnection();
    await assert.rejects(
      () => ctx.globalVfs().write("/other.md", "x"),
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
    await assert.rejects(() =>
      ctx.projectVfs(project.id).read("/template/note.md"),
    );
    await ctx.conn.close();
  });
});
