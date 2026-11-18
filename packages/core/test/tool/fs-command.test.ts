import { unwrap, rejectsErr } from "../helpers/result-unwrap.js";
import { isAppError } from "../../src/errors/app-error.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FsCommand, type FsToolInput } from "../../src/domain/tool/logic/fs-command.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

describe("fs-command parser", () => {
  it("parses ls variants", () => {
    // 四期签名：FsCommand.parse 失败沿 Result.err 回传，成功解包取命令。
    assert.deepEqual(unwrap(FsCommand.parse({ action: "ls" })), {
      kind: "ls",
      dir: "/",
      recursive: false,
    });
    assert.deepEqual(unwrap(FsCommand.parse({ action: "ls", path: "/docs" })), {
      kind: "ls",
      dir: "/docs",
      recursive: false,
    });
    assert.deepEqual(
      unwrap(FsCommand.parse({ action: "ls", path: "/docs", recursive: true })),
      {
        kind: "ls",
        dir: "/docs",
        recursive: true,
      },
    );
  });

  it("parses mv/rm -r/mkdir/cp -r", () => {
    assert.deepEqual(
      unwrap(FsCommand.parse({ action: "mv", from: "/a", to: "/b" })),
      { kind: "mv", from: "/a", to: "/b" },
    );
    assert.deepEqual(
      unwrap(FsCommand.parse({ action: "rm", path: "/dir", recursive: true })),
      { kind: "rm", path: "/dir", recursive: true },
    );
    assert.deepEqual(unwrap(FsCommand.parse({ action: "mkdir", path: "/new" })), {
      kind: "mkdir",
      path: "/new",
    });
    assert.deepEqual(
      unwrap(FsCommand.parse({
        action: "cp",
        from: "/src",
        to: "/dst",
        recursive: true,
      })),
      { kind: "cp", from: "/src", to: "/dst", recursive: true },
    );
  });

  it("支持路径含空格与中文", () => {
    assert.deepEqual(
      unwrap(FsCommand.parse({ action: "rm", path: "/my note.md" })),
      { kind: "rm", path: "/my note.md", recursive: false },
    );
    assert.deepEqual(
      unwrap(FsCommand.parse({ action: "mv", from: "/诗歌 集", to: "/poems" })),
      { kind: "mv", from: "/诗歌 集", to: "/poems" },
    );
  });

  it("FsCommand.isMutating distinguishes ls from rm", () => {
    assert.equal(FsCommand.isMutating({ action: "ls", path: "/" }), false);
    assert.equal(FsCommand.isMutating({ action: "rm", path: "x" }), true);
    assert.equal(
      FsCommand.isMutating({ action: "mv", from: "/a", to: "/b" }),
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
      const r = FsCommand.parse(input);
      assert.ok(!r.ok);
      if (!r.ok) assert.ok(isAppError(r.error, "TOOL_INVALID_ARGUMENT"));
    }
  });
});

describe("fs-command integration", () => {
  novelMasterTestFixture();

  it("FsCommand.execute mv/rm -r/mkdir/cp -r", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`p-${testIsolationSuffix()}`));
    const session = unwrap(await ctx.sessions.create(project.id));
    const vfs = ctx.sessionVfs(project.id, session.id);

    unwrap(await vfs.write("/a.txt", "body"));
    unwrap(
      await FsCommand.execute(
        vfs,
        unwrap(FsCommand.parse({ action: "mv", from: "/a.txt", to: "/b.txt" })),
      ),
    );
    assert.equal(unwrap(await vfs.read("/b.txt")).content, "body");

    unwrap(await FsCommand.execute(vfs, unwrap(FsCommand.parse({ action: "mkdir", path: "/dir" }))));
    unwrap(await vfs.write("/dir/x.txt", "x"));
    unwrap(
      await FsCommand.execute(
        vfs,
        unwrap(FsCommand.parse({
          action: "cp",
          from: "/dir",
          to: "/copy",
          recursive: true,
        })),
      ),
    );
    assert.equal(unwrap(await vfs.read("/copy/x.txt")).content, "x");

    unwrap(
      await FsCommand.execute(
        vfs,
        unwrap(FsCommand.parse({ action: "rm", path: "/copy", recursive: true })),
      ),
    );
    await rejectsErr(() => vfs.read("/copy/x.txt"));
  });

  it("rm without recursive recursively deletes non-empty directory", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`p-${testIsolationSuffix()}`));
    const session = unwrap(await ctx.sessions.create(project.id));
    const vfs = ctx.sessionVfs(project.id, session.id);

    unwrap(await vfs.mkdir("/55"));
    unwrap(await vfs.write("/55/诗歌.txt", "poem", { versionCheck: false }));

    unwrap(await FsCommand.execute(vfs, unwrap(FsCommand.parse({ action: "rm", path: "/55" }))));
    await rejectsErr(() => vfs.list("/55"));
  });

  it("rmdir fails on non-empty directory", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`p-${testIsolationSuffix()}`));
    const session = unwrap(await ctx.sessions.create(project.id));
    const vfs = ctx.sessionVfs(project.id, session.id);
    unwrap(await vfs.mkdir("/dir"));
    await vfs.write("/dir/a.txt", "stay");

    await rejectsErr(() =>
      FsCommand.execute(vfs, unwrap(FsCommand.parse({ action: "rmdir", path: "/dir" }))),
    );
  });

  it("ls output truncates at 50KB", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`p-${testIsolationSuffix()}`));
    const session = unwrap(await ctx.sessions.create(project.id));
    const vfs = ctx.sessionVfs(project.id, session.id);
    for (let i = 0; i < 4000; i++) {
      unwrap(await vfs.write(`/f-${i}.txt`, "x"));
    }
    const out = unwrap(
      await FsCommand.execute(
        vfs,
        unwrap(FsCommand.parse({ action: "ls", path: "/", recursive: true })),
      ),
    );
    assert.ok("entries" in out);
    assert.equal(out.truncated, true);
    assert.ok(out.entries.length < out.total);
  });
});
