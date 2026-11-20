import {  rejectsErr, unwrap  } from "../helpers/result-unwrap.js";
import {  AppErrorOps  } from "../../src/errors/app-error.js";
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  LogicalPath  } from "../../src/domain/vfs/logic/vfs-path-mapper.js";
import {  getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix  } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("ScopedVfsService", () => {
  it("isolates global template from project", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.globalVfs().write("/g.md", "global");
    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    const pvfs = ctx.projectVfs(project.id);
    const projectPaths = unwrap(await pvfs.list("/", { recursive: true }));
    assert.equal(projectPaths.length, 0);
  });

  it("global list shows unified logical paths", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.globalVfs().write("/seed/hello.md", "hi");
    const paths = unwrap(await ctx.globalVfs().list("/", { recursive: true }));
    assert.ok(paths.some((e) => e.path === "/seed/hello.md"));
    assert.ok(!paths.some((e) => e.path.startsWith("/template/")));
  });

  it("T3: project write and read round-trip unified paths", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/prompts/system.md", "system prompt");
    assert.equal(
      unwrap(LogicalPath.toPhysical({ kind: "project", projectId: project.id }, "/prompts/system.md")),
      `/projects/${project.id}/template/prompts/system.md`,
    );
    const read = unwrap(await pvfs.read("/prompts/system.md"));
    assert.equal(read.content, "system prompt");
    assert.equal(read.path, "/prompts/system.md");
  });

  it("rejects legacy /template logical paths", async () => {
    const ctx = getNovelMasterTestContext();
    await rejectsErr(() => ctx.globalVfs().write("/template/legacy.md", "x"), (e: unknown) => {
      assert.ok(AppErrorOps.is(e, "VFS_INVALID_PATH"));
    });
  });

  it("session paths invisible to project scope", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    const session = unwrap(await ctx.sessions.create(project.id));
    unwrap(await ctx.sessionVfs(project.id, session.id).write("/note.md", "n"));
    await rejectsErr(() => ctx.projectVfs(project.id).read("/note.md"), (e: unknown) => {
      assert.ok(AppErrorOps.is(e, "VFS_NOT_FOUND"));
    });
  });

  it("grep with pathGlob filters logical paths", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/grep-glob/a.md", "# A");
    await pvfs.write("/grep-glob/b.txt", "# B");
    const hits = unwrap(await pvfs.grep("#", { pathGlob: "/grep-glob/**/*.md" }));
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.path, "/grep-glob/a.md");
    assert.equal(hits[0]!.line, 1);
  });
});
