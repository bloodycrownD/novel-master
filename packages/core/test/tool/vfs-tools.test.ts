import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import {
  isMutatingFileToolName,
  MUTATING_FILE_TOOL_NAMES,
  registerVfsTools,
  type VfsToolContext,
} from "../../src/domain/tool/builtin/vfs-tools.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import { isVfsError } from "@novel-master/core";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


function toolCtx(
  vfs: VfsToolContext["vfs"],
  projectId: string,
  sessionId: string,
): VfsToolContext {
  return { vfs, projectId, sessionId };
}

novelMasterTestFixture();

describe("Builtin file tools (integration)", () => {
  it("write/replace/read flow via revision-aware vfs", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    const written = await runner.call<{ version: number }>(
      "write",
      { path: "/t.txt", content: "hello world" },
      baseCtx,
    );
    assert.equal(written.version, 1);

    const replaced = await runner.call<{ version: number; replacements: number }>(
      "replace",
      { path: "/t.txt", oldString: "world", newString: "there" },
      baseCtx,
    );
    assert.equal(replaced.replacements, 1);

    const read = await runner.call<{ content: string; version: number }>(
      "read",
      { path: "/t.txt" },
      baseCtx,
    );
    assert.equal(read.content, "hello there");
    assert.equal(read.version, 2);
  });

  it("write without options overwrites an existing file", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call("write", { path: "/t.txt", content: "v1" }, baseCtx);
    await runner.call("write", { path: "/t.txt", content: "v2" }, baseCtx);
    const read = await runner.call<{ content: string }>(
      "read",
      { path: "/t.txt" },
      baseCtx,
    );
    assert.equal(read.content, "v2");
  });

  it("vfs.write respects versionCheck and expectedVersion options", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call("write", { path: "/t.txt", content: "v1" }, baseCtx);
    const second = await runner.call<{ version: number }>(
      "write",
      {
        path: "/t.txt",
        content: "v2",
        options: { expectedVersion: 1, versionCheck: true },
      },
      baseCtx,
    );
    assert.equal(second.version, 2);

    await assert.rejects(
      () =>
        runner.call(
          "write",
          {
            path: "/t.txt",
            content: "stale",
            options: { expectedVersion: 1, versionCheck: true },
          },
          baseCtx,
        ),
      (e: unknown) => e instanceof ToolError && e.code === "FAILED",
    );

    const unchecked = await runner.call<{ version: number }>(
      "write",
      { path: "/t.txt", content: "v3", options: { versionCheck: false } },
      baseCtx,
    );
    assert.equal(unchecked.version, 3);
  });

  it("list/glob/grep flow", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/docs/a.md", "# A");
    await vfs.write("/docs/b.txt", "plain");

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    const listed = await runner.call<Array<{ path: string; kind: string }>>(
      "list",
      { dir: "/docs" },
      baseCtx,
    );
    const paths = listed.map((e) => e.path).sort();
    assert.deepEqual(paths, ["/docs/a.md", "/docs/b.txt"].sort());

    const md = await runner.call<string[]>("glob", { pattern: "**/*.md" }, baseCtx);
    assert.deepEqual(md, ["/docs/a.md"]);

    const hits = await runner.call<any[]>("grep", { pattern: "#" }, baseCtx);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.path, "/docs/a.md");
    assert.equal(hits[0]!.line, 1);
  });

  it("vfs.mkdir creates directory visible in list", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call("mkdir", { path: "/agent-dir" }, baseCtx);
    const listed = await runner.call<Array<{ path: string; kind: string }>>(
      "list",
      { dir: "/" },
      baseCtx,
    );
    assert.ok(
      listed.some((e) => e.path === "/agent-dir" && e.kind === "directory"),
    );
  });

  it("registers exactly 10 vfs tools", () => {
    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    assert.equal(registry.list().length, 10);
    assert.deepEqual(registry.list().sort(), [
      "copy",
      "delete",
      "glob",
      "grep",
      "list",
      "mkdir",
      "move",
      "read",
      "replace",
      "write",
    ]);
  });

  it("vfs.delete removes a file (non-recursive default)", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/a.txt", "gone");

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    const result = await runner.call<{ ok: true }>(
      "delete",
      { path: "/a.txt" },
      baseCtx,
    );
    assert.deepEqual(result, { ok: true });
    await assert.rejects(
      () => runner.call("read", { path: "/a.txt" }, baseCtx),
      (e: unknown) => e instanceof ToolError && e.code === "FAILED",
    );
  });

  it("vfs.delete non-recursive fails on non-empty directory", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.mkdir("/dir");
    await vfs.write("/dir/a.txt", "stay");

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await assert.rejects(
      () => runner.call("delete", { path: "/dir" }, baseCtx),
      (e: unknown) => e instanceof ToolError && e.code === "FAILED",
    );
    assert.equal((await vfs.read("/dir/a.txt")).content, "stay");
  });

  it("vfs.delete recursive removes directory tree", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.mkdir("/dir");
    await vfs.write("/dir/a.txt", "gone");

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call(
      "delete",
      { path: "/dir", options: { recursive: true } },
      baseCtx,
    );
    await assert.rejects(
      () => vfs.read("/dir/a.txt"),
      (e: unknown) => isVfsError(e, "NOT_FOUND"),
    );
  });

  it("vfs.move migrates file content", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/old.md", "body");

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call(
      "move",
      { from: "/old.md", to: "/new.md" },
      baseCtx,
    );
    assert.equal((await vfs.read("/new.md")).content, "body");
    await assert.rejects(
      () => vfs.read("/old.md"),
      (e: unknown) => isVfsError(e, "NOT_FOUND"),
    );
  });

  it("vfs.move migrates directory tree", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.mkdir("/src");
    await vfs.mkdir("/src/sub");
    await vfs.write("/src/a.md", "a");
    await vfs.write("/src/sub/b.md", "b");

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call("move", { from: "/src", to: "/dst" }, baseCtx);
    assert.equal((await vfs.read("/dst/a.md")).content, "a");
    assert.equal((await vfs.read("/dst/sub/b.md")).content, "b");
    await assert.rejects(
      () => vfs.read("/src/a.md"),
      (e: unknown) => isVfsError(e, "NOT_FOUND"),
    );
  });

  it("vfs.copy duplicates file and keeps source", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/src/x.md", "x");

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call(
      "copy",
      { from: "/src/x.md", to: "/dst/x.md" },
      baseCtx,
    );
    assert.equal((await vfs.read("/src/x.md")).content, "x");
    assert.equal((await vfs.read("/dst/x.md")).content, "x");
  });

  it("vfs.copy recursive duplicates directory tree", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.mkdir("/src");
    await vfs.write("/src/x.md", "x");

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call(
      "copy",
      { from: "/src", to: "/dst", options: { recursive: true } },
      baseCtx,
    );
    assert.equal((await vfs.read("/src/x.md")).content, "x");
    assert.equal((await vfs.read("/dst/x.md")).content, "x");
  });

  it("vfs.copy without recursive fails on directory", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.mkdir("/src");
    await vfs.write("/src/x.md", "x");

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await assert.rejects(
      () => runner.call("copy", { from: "/src", to: "/dst" }, baseCtx),
      (e: unknown) => e instanceof ToolError && e.code === "FAILED",
    );
  });

  it("mutating vfs tool names include write/replace/delete/mkdir/move/copy only", () => {
    assert.deepEqual([...MUTATING_FILE_TOOL_NAMES].sort(), [
      "copy",
      "delete",
      "mkdir",
      "move",
      "replace",
      "write",
    ]);
    assert.equal(isMutatingFileToolName("read"), false);
    assert.equal(isMutatingFileToolName("list"), false);
    assert.equal(isMutatingFileToolName("glob"), false);
    assert.equal(isMutatingFileToolName("grep"), false);
    assert.equal(isMutatingFileToolName("move"), true);
  });

  it("wraps VfsError as FAILED and preserves cause", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await assert.rejects(
      () => runner.call("read", { path: "/missing.txt" }, baseCtx),
      (e: unknown) => {
        assert.ok(e instanceof ToolError);
        assert.equal(e.code, "FAILED");
        assert.equal(e.toolName, "read");
        assert.ok(isVfsError(e.cause, "NOT_FOUND"));
        return true;
      },
    );
  });

  it("vfs.delete on missing path wraps VfsError NOT_FOUND as FAILED", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await assert.rejects(
      () => runner.call("delete", { path: "/missing.txt" }, baseCtx),
      (e: unknown) => {
        assert.ok(e instanceof ToolError);
        assert.equal(e.code, "FAILED");
        assert.equal(e.toolName, "delete");
        assert.ok(isVfsError(e.cause, "NOT_FOUND"));
        return true;
      },
    );
  });
});
