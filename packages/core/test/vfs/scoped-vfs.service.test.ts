import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVfsError, toPhysicalPath } from "@novel-master/core";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("ScopedVfsService", () => {
  it("isolates global template from project", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.globalVfs().write("/g.md", "global");
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    const projectPaths = await pvfs.list("/", { recursive: true });
    assert.equal(projectPaths.length, 0);
  });

  it("global list shows unified logical paths", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.globalVfs().write("/seed/hello.md", "hi");
    const paths = await ctx.globalVfs().list("/", { recursive: true });
    assert.ok(paths.some((e) => e.path === "/seed/hello.md"));
    assert.ok(!paths.some((e) => e.path.startsWith("/template/")));
  });

  it("T3: project write and read round-trip unified paths", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/prompts/system.md", "system prompt");
    assert.equal(
      toPhysicalPath({ kind: "project", projectId: project.id }, "/prompts/system.md"),
      `/projects/${project.id}/template/prompts/system.md`,
    );
    const read = await pvfs.read("/prompts/system.md");
    assert.equal(read.content, "system prompt");
    assert.equal(read.path, "/prompts/system.md");
  });

  it("rejects legacy /template logical paths", async () => {
    const ctx = getNovelMasterTestContext();
    await assert.rejects(
      () => ctx.globalVfs().write("/template/legacy.md", "x"),
      (e: unknown) => {
        assert.ok(isVfsError(e, "INVALID_PATH"));
        return true;
      },
    );
  });

  it("session paths invisible to project scope", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    await ctx.sessionVfs(project.id, session.id).write("/note.md", "n");
    await assert.rejects(() => ctx.projectVfs(project.id).read("/note.md"));
  });
});
