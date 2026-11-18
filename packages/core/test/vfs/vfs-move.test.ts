import { isAppError } from "../../src/errors/app-error.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VfsMove } from "../../src/domain/vfs/logic/vfs-move.js";
import { Path } from "../../src/common/path.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";
import { rejectsErr, unwrap } from "../helpers/result-unwrap.js";

novelMasterTestFixture();

function assertOk(result: { readonly ok: boolean }): void {
  assert.ok(result.ok);
}

describe("moveVfsPath", () => {
  it("moves a file and preserves content", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    unwrap(await vfs.write("/old.md", "content"));
    assertOk(await VfsMove.move(vfs, "/old.md", "/new.md"));

    const read = unwrap(await vfs.read("/new.md"));
    assert.equal(read.content, "content");
    await rejectsErr(() => vfs.read("/old.md"), (e: unknown) => {
      assert.ok(isAppError(e, "VFS_NOT_FOUND"));
    });
  });

  it("moves a directory tree", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    unwrap(await vfs.mkdir("/src"));
    unwrap(await vfs.mkdir("/src/sub"));
    unwrap(await vfs.write("/src/a.md", "a"));
    unwrap(await vfs.write("/src/sub/b.md", "b"));

    assertOk(await VfsMove.move(vfs, "/src", "/dst"));

    assert.equal(unwrap(await vfs.read("/dst/a.md")).content, "a");
    assert.equal(unwrap(await vfs.read("/dst/sub/b.md")).content, "b");
    await rejectsErr(() => vfs.read("/src/a.md"), (e: unknown) => {
      assert.ok(isAppError(e, "VFS_NOT_FOUND"));
    });
  });

  it("renames an empty directory right after mkdir", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    unwrap(await vfs.mkdir("/empty-dir"));

    // 空目录（有 directory 行、零子项）也必须允许 rename，不能误报 NOT_FOUND。
    assertOk(await VfsMove.move(vfs, "/empty-dir", "/renamed-dir"));

    // directory 行的 path 已更新：新路径是空目录（list 成功且为空），旧路径不存在。
    assert.deepEqual(unwrap(await vfs.list("/renamed-dir")), []);
    await rejectsErr(() => vfs.list("/empty-dir"), (e: unknown) => {
      assert.ok(isAppError(e, "VFS_NOT_FOUND"));
    });

    // rename 后新目录仍可正常写入子项。
    unwrap(await vfs.write("/renamed-dir/note.md", "hi"));
    assert.equal(unwrap(await vfs.read("/renamed-dir/note.md")).content, "hi");
  });

  it("moves a directory whose name contains % and _ (LIKE wildcard chars)", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const suffix = testIsolationSuffix();

    // %/_ 是 LIKE 通配字符，move 的子项迁移依赖 ScopePrefix.escapeLike + ESCAPE '\'
    // 转义后匹配，目录名含它们时根行与子项都要完整迁移、旧路径无残留。
    const oldDir = `/源_目%录-${suffix}`;
    const newDir = `/目_标%d-${suffix}`;

    unwrap(await vfs.mkdir(oldDir));
    unwrap(await vfs.write(`${oldDir}/child.md`, "child"));

    assertOk(await VfsMove.move(vfs, oldDir, newDir));

    assert.equal(unwrap(await vfs.read(`${newDir}/child.md`)).content, "child");
    const children = unwrap(await vfs.list(newDir));
    assert.equal(
      children.some((e) => e.path === `${newDir}/child.md`),
      true
    );
    await rejectsErr(() => vfs.read(`${oldDir}/child.md`), (e: unknown) => {
      assert.ok(isAppError(e, "VFS_NOT_FOUND"));
    });
    await rejectsErr(() => vfs.list(oldDir), (e: unknown) => {
      assert.ok(isAppError(e, "VFS_NOT_FOUND"));
    });
  });

  it("fails when target file already exists and keeps source", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    unwrap(await vfs.write("/a.md", "original-a"));
    unwrap(await vfs.write("/b.md", "original-b"));

    const result = await VfsMove.move(vfs, "/b.md", "/a.md");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.key, "VFS_ALREADY_EXISTS");
    assert.equal(unwrap(await vfs.read("/a.md")).content, "original-a");
    assert.equal(unwrap(await vfs.read("/b.md")).content, "original-b");
  });

  it("fails when target directory already exists", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    unwrap(await vfs.mkdir("/dirA"));
    unwrap(await vfs.write("/other.md", "stay"));

    const result = await VfsMove.move(vfs, "/other.md", "/dirA");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.key, "VFS_ALREADY_EXISTS");
    assert.equal(unwrap(await vfs.read("/other.md")).content, "stay");
    unwrap(await vfs.list("/dirA"));
  });

  it("no-ops when from and to normalize to the same path", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    unwrap(await vfs.write("/same.md", "content"));
    assertOk(await VfsMove.move(vfs, "/same.md", "/same.md"));
    assert.equal(unwrap(await vfs.read("/same.md")).content, "content");
  });

  it("fails with NOT_FOUND for missing path", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const result = await VfsMove.move(vfs, "/missing", "/elsewhere");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.key, "VFS_NOT_FOUND");
  });
});

describe("Path.remapUnderDir", () => {
  it("remaps nested paths under a new directory root", () => {
    assert.equal(Path.remapUnderDir("/src/sub/file.txt", "/src", "/dst"), "/dst/sub/file.txt");
    assert.equal(Path.remapUnderDir("/src", "/src", "/dst"), "/dst");
  });
});
