import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import {
  registerVfsTools,
  type VfsToolContext,
} from "../../src/domain/tool/builtin/vfs-tools.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import { isVfsError } from "@novel-master/core";

function toolCtx(
  vfs: VfsToolContext["vfs"],
  projectId: string,
  sessionId: string,
): VfsToolContext {
  return { vfs, projectId, sessionId };
}

describe("Builtin vfs.* tools (integration)", () => {
  it("write/replace/read flow via revision-aware vfs", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("p");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    const written = await runner.call<{ version: number }>(
      "vfs.write",
      { path: "/t.txt", content: "hello world" },
      baseCtx,
    );
    assert.equal(written.version, 1);

    const replaced = await runner.call<{ version: number; replacements: number }>(
      "vfs.replace",
      { path: "/t.txt", oldString: "world", newString: "there" },
      baseCtx,
    );
    assert.equal(replaced.replacements, 1);

    const read = await runner.call<{ content: string; version: number }>(
      "vfs.read",
      { path: "/t.txt" },
      baseCtx,
    );
    assert.equal(read.content, "hello there");
    assert.equal(read.version, 2);

    const batches = await ctx.sessionFs.listBatches(session.id);
    assert.equal(batches.length, 0);
    await ctx.conn.close();
  });

  it("vfs.write respects versionCheck and expectedVersion options", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("p");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call("vfs.write", { path: "/t.txt", content: "v1" }, baseCtx);
    const second = await runner.call<{ version: number }>(
      "vfs.write",
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
          "vfs.write",
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
      "vfs.write",
      { path: "/t.txt", content: "v3", options: { versionCheck: false } },
      baseCtx,
    );
    assert.equal(unchecked.version, 3);
    await ctx.conn.close();
  });

  it("list/glob/grep flow", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("p");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/docs/a.md", "# A");
    await vfs.write("/docs/b.txt", "plain");

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    const listed = await runner.call<Array<{ path: string; kind: string }>>(
      "vfs.list",
      { dir: "/docs" },
      baseCtx,
    );
    const paths = listed.map((e) => e.path).sort();
    assert.deepEqual(paths, ["/docs/a.md", "/docs/b.txt"].sort());

    const md = await runner.call<string[]>("vfs.glob", { pattern: "**/*.md" }, baseCtx);
    assert.deepEqual(md, ["/docs/a.md"]);

    const hits = await runner.call<any[]>("vfs.grep", { pattern: "#" }, baseCtx);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.path, "/docs/a.md");
    assert.equal(hits[0]!.line, 1);
    await ctx.conn.close();
  });

  it("vfs.mkdir creates directory visible in list", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("p");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call("vfs.mkdir", { path: "/agent-dir" }, baseCtx);
    const listed = await runner.call<Array<{ path: string; kind: string }>>(
      "vfs.list",
      { dir: "/" },
      baseCtx,
    );
    assert.ok(
      listed.some((e) => e.path === "/agent-dir" && e.kind === "directory"),
    );
    await ctx.conn.close();
  });

  it("wraps VfsError as FAILED and preserves cause", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("p");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await assert.rejects(
      () => runner.call("vfs.read", { path: "/missing.txt" }, baseCtx),
      (e: unknown) => {
        assert.ok(e instanceof ToolError);
        assert.equal(e.code, "FAILED");
        assert.equal(e.toolName, "vfs.read");
        assert.ok(isVfsError(e.cause, "NOT_FOUND"));
        return true;
      },
    );
    await ctx.conn.close();
  });
});
