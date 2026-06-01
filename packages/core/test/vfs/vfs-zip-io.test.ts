import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unzipSync, zipSync } from "fflate";
import {
  createVfsZipIoService,
  VfsZipError,
} from "@novel-master/core";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";
import { buildVfsZip } from "../../src/domain/vfs/logic/vfs-zip-build.js";

describe("VfsZipIoService", () => {
  it("Z1: session export includes logical paths in ZIP", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/a.md", "A");
    await vfs.write("/dir/b.md", "B");

    const zipSvc = createVfsZipIoService(ctx.conn);
    const bytes = await zipSvc.export({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const entries = unzipSync(bytes);
    assert.ok("a.md" in entries);
    assert.ok("dir/b.md" in entries);
    assert.equal(new TextDecoder().decode(entries["a.md"]!), "A");
    await ctx.conn.close();
  });

  it("Z2: global export has no projects/ prefix", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.globalVfs().write("/template/x.md", "X");
    const zipSvc = createVfsZipIoService(ctx.conn);
    const bytes = await zipSvc.export({ kind: "global" });
    const names = Object.keys(unzipSync(bytes));
    assert.ok(names.includes("template/x.md"));
    assert.ok(!names.some((n) => n.startsWith("projects/")));
    await ctx.conn.close();
  });

  it("Z3: import replaces domain file tree", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/old.md", "old");

    const zipSvc = createVfsZipIoService(ctx.conn);
    await zipSvc.import(
      { kind: "session", projectId: project.id, sessionId: session.id },
      buildVfsZip(new Map([["new.md", "new"]])),
      { confirmed: true },
    );

    await assert.rejects(() => vfs.read("/old.md"));
    const read = await vfs.read("/new.md");
    assert.equal(read.content, "new");
    await ctx.conn.close();
  });

  it("Z4: invalid UTF-8 rejects import without changing domain", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/keep.md", "keep");

    const zipSvc = createVfsZipIoService(ctx.conn);
    const invalidUtf8Zip = zipSync({
      "bad.md": new Uint8Array([0xff, 0xfe, 0x80]),
    });
    await assert.rejects(
      () =>
        zipSvc.import(
          { kind: "session", projectId: project.id, sessionId: session.id },
          invalidUtf8Zip,
          { confirmed: true },
        ),
      (e: unknown) =>
        e instanceof VfsZipError && e.code === "INVALID_UTF8",
    );

    const still = await vfs.read("/keep.md");
    assert.equal(still.content, "keep");
    await ctx.conn.close();
  });

  it("Z5: transaction failure rolls back domain", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/before.md", "before");

    const zipSvc = createVfsZipIoService(ctx.conn, {
      testHook: { throwOnInsertLogical: "/new.md" },
    });
    const zipBytes = buildVfsZip(
      new Map([
        ["before.md", "mutated"],
        ["new.md", "new"],
      ]),
    );

    await assert.rejects(
      () =>
        zipSvc.import(
          { kind: "session", projectId: project.id, sessionId: session.id },
          zipBytes,
          { confirmed: true },
        ),
    );

    const read = await vfs.read("/before.md");
    assert.equal(read.content, "before");
    await assert.rejects(() => vfs.read("/new.md"));
    await ctx.conn.close();
  });

  it("Z6: import without confirmed does not change domain", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/stay.md", "stay");

    const zipSvc = createVfsZipIoService(ctx.conn);
    const zipBytes = buildVfsZip(new Map([["other.md", "x"]]));
    await assert.rejects(
      () =>
        zipSvc.import(
          { kind: "session", projectId: project.id, sessionId: session.id },
          zipBytes,
          { confirmed: false },
        ),
      (e: unknown) =>
        e instanceof VfsZipError && e.code === "NOT_CONFIRMED",
    );
    const read = await vfs.read("/stay.md");
    assert.equal(read.content, "stay");
    await ctx.conn.close();
  });

  it("project scope export round-trips template tree", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P2");
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/template/t.md", "T");

    const zipSvc = createVfsZipIoService(ctx.conn);
    const bytes = await zipSvc.export({ kind: "project", projectId: project.id });
    const names = Object.keys(unzipSync(bytes));
    assert.ok(names.includes("template/t.md"));

    await zipSvc.import(
      { kind: "project", projectId: project.id },
      buildVfsZip(new Map([["template/t.md", "T2"]])),
      { confirmed: true },
    );
    const read = await pvfs.read("/template/t.md");
    assert.equal(read.content, "T2");
    await ctx.conn.close();
  });
});
