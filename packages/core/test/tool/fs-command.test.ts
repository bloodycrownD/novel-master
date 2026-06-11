import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executeFsCommand,
  isMutatingFsCommand,
  parseFsCommand,
} from "../../src/domain/tool/logic/fs-command.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

describe("fs-command parser", () => {
  it("parses ls variants", () => {
    assert.deepEqual(parseFsCommand("ls"), {
      kind: "ls",
      dir: "/",
      recursive: false,
    });
    assert.deepEqual(parseFsCommand("ls /docs"), {
      kind: "ls",
      dir: "/docs",
      recursive: false,
    });
    assert.deepEqual(parseFsCommand("ls -r /docs"), {
      kind: "ls",
      dir: "/docs",
      recursive: true,
    });
  });

  it("parses mv/rm -r/mkdir/cp -r", () => {
    assert.deepEqual(parseFsCommand("mv /a /b"), {
      kind: "mv",
      from: "/a",
      to: "/b",
    });
    assert.deepEqual(parseFsCommand("rm -r /dir"), {
      kind: "rm",
      path: "/dir",
      recursive: true,
    });
    assert.deepEqual(parseFsCommand("mkdir /new"), {
      kind: "mkdir",
      path: "/new",
    });
    assert.deepEqual(parseFsCommand("cp -r /src /dst"), {
      kind: "cp",
      from: "/src",
      to: "/dst",
      recursive: true,
    });
  });

  it("T2b: isMutatingFsCommand distinguishes ls from rm", () => {
    assert.equal(isMutatingFsCommand("ls /"), false);
    assert.equal(isMutatingFsCommand("rm x"), true);
    assert.equal(isMutatingFsCommand("mv /a /b"), true);
  });

  it("rejects illegal commands", () => {
    for (const cmd of ["foo bar", "rm a && rm b", "ls | grep x"]) {
      assert.throws(
        () => parseFsCommand(cmd),
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
    await executeFsCommand(vfs, parseFsCommand("mv /a.txt /b.txt"));
    assert.equal((await vfs.read("/b.txt")).content, "body");

    await executeFsCommand(vfs, parseFsCommand("mkdir /dir"));
    await vfs.write("/dir/x.txt", "x");
    await executeFsCommand(vfs, parseFsCommand("cp -r /dir /copy"));
    assert.equal((await vfs.read("/copy/x.txt")).content, "x");

    await executeFsCommand(vfs, parseFsCommand("rm -r /copy"));
    await assert.rejects(() => vfs.read("/copy/x.txt"));
  });

  it("rmdir fails on non-empty directory", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.mkdir("/dir");
    await vfs.write("/dir/a.txt", "stay");

    await assert.rejects(
      () => executeFsCommand(vfs, parseFsCommand("rmdir /dir")),
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
    const out = await executeFsCommand(vfs, parseFsCommand("ls -r /"));
    assert.ok("entries" in out);
    assert.equal(out.truncated, true);
    assert.ok(out.entries.length < out.total);
  });
});
