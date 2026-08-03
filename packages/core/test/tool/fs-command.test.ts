import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executeFsCommand,
  isMutatingFsCommand,
  parseFsCommand,
  type FsToolInput,
} from "../../src/domain/tool/logic/fs-command.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

describe("fs-command parser", () => {
  it("parses ls variants", () => {
    assert.deepEqual(parseFsCommand({ action: "ls" }), {
      kind: "ls",
      dir: "/",
      recursive: false,
    });
    assert.deepEqual(parseFsCommand({ action: "ls", path: "/docs" }), {
      kind: "ls",
      dir: "/docs",
      recursive: false,
    });
    assert.deepEqual(
      parseFsCommand({ action: "ls", path: "/docs", recursive: true }),
      {
        kind: "ls",
        dir: "/docs",
        recursive: true,
      },
    );
  });

  it("parses mv/rm -r/mkdir/cp -r", () => {
    assert.deepEqual(
      parseFsCommand({ action: "mv", from: "/a", to: "/b" }),
      { kind: "mv", from: "/a", to: "/b" },
    );
    assert.deepEqual(
      parseFsCommand({ action: "rm", path: "/dir", recursive: true }),
      { kind: "rm", path: "/dir", recursive: true },
    );
    assert.deepEqual(parseFsCommand({ action: "mkdir", path: "/new" }), {
      kind: "mkdir",
      path: "/new",
    });
    assert.deepEqual(
      parseFsCommand({
        action: "cp",
        from: "/src",
        to: "/dst",
        recursive: true,
      }),
      { kind: "cp", from: "/src", to: "/dst", recursive: true },
    );
  });

  it("支持路径含空格与中文", () => {
    assert.deepEqual(
      parseFsCommand({ action: "rm", path: "/my note.md" }),
      { kind: "rm", path: "/my note.md", recursive: false },
    );
    assert.deepEqual(
      parseFsCommand({ action: "mv", from: "/诗歌 集", to: "/poems" }),
      { kind: "mv", from: "/诗歌 集", to: "/poems" },
    );
  });

  it("isMutatingFsCommand distinguishes ls from rm", () => {
    assert.equal(isMutatingFsCommand({ action: "ls", path: "/" }), false);
    assert.equal(isMutatingFsCommand({ action: "rm", path: "x" }), true);
    assert.equal(
      isMutatingFsCommand({ action: "mv", from: "/a", to: "/b" }),
      true,
    );
  });

  it("rejects illegal inputs", () => {
    const bad: FsToolInput[] = [
      { action: "foo" },
      { action: "rm" },
      { action: "mv", from: "/a" },
      { action: "cp", to: "/b" },
    ];
    for (const input of bad) {
      assert.throws(
        () => parseFsCommand(input),
        (e: unknown) => e instanceof ToolError && e.code === "INVALID_ARGUMENT",
      );
    }
  });
});

describe("fs-command integration", () => {
  novelMasterTestFixture();

  it("executeFsCommand mv/rm -r/mkdir/cp -r", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.write("/a.txt", "body");
    await executeFsCommand(
      vfs,
      parseFsCommand({ action: "mv", from: "/a.txt", to: "/b.txt" }),
    );
    assert.equal((await vfs.read("/b.txt")).content, "body");

    await executeFsCommand(vfs, parseFsCommand({ action: "mkdir", path: "/dir" }));
    await vfs.write("/dir/x.txt", "x");
    await executeFsCommand(
      vfs,
      parseFsCommand({
        action: "cp",
        from: "/dir",
        to: "/copy",
        recursive: true,
      }),
    );
    assert.equal((await vfs.read("/copy/x.txt")).content, "x");

    await executeFsCommand(
      vfs,
      parseFsCommand({ action: "rm", path: "/copy", recursive: true }),
    );
    await assert.rejects(() => vfs.read("/copy/x.txt"));
  });

  it("rm without recursive recursively deletes non-empty directory", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.mkdir("/55");
    await vfs.write("/55/诗歌.txt", "poem", { versionCheck: false });

    await executeFsCommand(vfs, parseFsCommand({ action: "rm", path: "/55" }));
    await assert.rejects(() => vfs.list("/55"));
  });

  it("rmdir fails on non-empty directory", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.mkdir("/dir");
    await vfs.write("/dir/a.txt", "stay");

    await assert.rejects(() =>
      executeFsCommand(vfs, parseFsCommand({ action: "rmdir", path: "/dir" })),
    );
  });

  it("ls output truncates at 50KB", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    for (let i = 0; i < 4000; i++) {
      await vfs.write(`/f-${i}.txt`, "x");
    }
    const out = await executeFsCommand(
      vfs,
      parseFsCommand({ action: "ls", path: "/", recursive: true }),
    );
    assert.ok("entries" in out);
    assert.equal(out.truncated, true);
    assert.ok(out.entries.length < out.total);
  });
});
