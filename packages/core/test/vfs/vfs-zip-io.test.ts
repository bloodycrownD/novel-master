import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unzipSync, zipSync } from "fflate";
import {
  createVfsZipIoService,
  VfsZipError,
} from "@novel-master/core";
import type { VfsService } from "@novel-master/core";
import { buildVfsZip } from "../../src/domain/vfs/logic/vfs-zip-build.js";
import { decodeUtf8Entry } from "../../src/domain/vfs/logic/vfs-zip-validate.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


async function listFilePaths(vfs: VfsService, dir = "/"): Promise<string[]> {
  const entries = await vfs.list(dir, { recursive: true });
  return entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.path)
    .sort();
}


novelMasterTestFixture();

describe("VfsZipIoService", () => {
  it("Z1: session export includes logical paths in ZIP", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
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
  });

  it("Z2: global export has no projects/ prefix", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.globalVfs().write("/x.md", "X");
    const zipSvc = createVfsZipIoService(ctx.conn);
    const bytes = await zipSvc.export({ kind: "global" });
    const names = Object.keys(unzipSync(bytes));
    assert.ok(names.includes("x.md"));
    assert.ok(!names.some((n) => n.startsWith("template/")));
    assert.ok(!names.some((n) => n.startsWith("projects/")));
  });

  it("Z3: import replaces domain file tree", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
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
  });

  it("markdown front matter passes UTF-8 zip validation", () => {
    const content = "---\ntitle: x\n---\n# Hi\n";
    const bytes = new TextEncoder().encode(content);
    assert.equal(decodeUtf8Entry(bytes, "xxx.md"), content);
  });

  it("Z4: invalid UTF-8 rejects import without changing domain", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
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
  });

  it("Z5: transaction failure rolls back domain", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
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
  });

  it("Z6: import without confirmed does not change domain", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
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
  });

  it("export/import preserves explicit empty directory", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-empty-dir-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.mkdir("/test");
    await vfs.write("/note.md", "x");
    assert.ok(
      (await vfs.list("/")).some(
        (e) => e.kind === "directory" && e.path === "/test",
      ),
      "mkdir should create /test directory row",
    );

    const zipSvc = createVfsZipIoService(ctx.conn);
    const exported = await zipSvc.export(scope);
    const names = Object.keys(unzipSync(exported));
    assert.ok(names.includes("test/"), `expected test/ dir marker, got ${names.join(",")}`);

    await vfs.write("/note.md", "mutated", { versionCheck: false });
    await vfs.delete("/test", { recursive: true });

    await zipSvc.import(scope, exported, { confirmed: true });

    const entries = await vfs.list("/", { recursive: false });
    assert.ok(
      entries.some((e) => e.kind === "directory" && e.path === "/test"),
      "empty directory /test should exist after import",
    );
    assert.equal((await vfs.read("/note.md")).content, "x");
  });

  it("session export bytes round-trip import with UTF-8 text", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-rt-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.write("/ddd/love_message.txt", "你好\nline2");
    await vfs.write("/note.md", "ascii");

    const zipSvc = createVfsZipIoService(ctx.conn);
    const exported = await zipSvc.export(scope);
    await zipSvc.import(scope, exported, { confirmed: true });

    assert.deepEqual(await listFilePaths(vfs), ["/ddd/love_message.txt", "/note.md"]);
    assert.equal((await vfs.read("/ddd/love_message.txt")).content, "你好\nline2");
    assert.equal((await vfs.read("/note.md")).content, "ascii");
  });

  it("Z7: same ZIP bytes yield identical file paths in two session scopes", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-z7-${testIsolationSuffix()}`);
    const sessionA = await ctx.sessions.create(project.id);
    const sessionB = await ctx.sessions.create(project.id);
    const zipBytes = buildVfsZip(
      new Map([
        ["alpha.md", "alpha"],
        ["dir/beta.md", "beta"],
      ]),
    );
    const zipSvc = createVfsZipIoService(ctx.conn);
    const scopeA = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: sessionA.id,
    };
    const scopeB = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: sessionB.id,
    };
    await zipSvc.import(scopeA, zipBytes, { confirmed: true });
    await zipSvc.import(scopeB, zipBytes, { confirmed: true });

    const pathsA = await listFilePaths(ctx.sessionVfs(project.id, sessionA.id));
    const pathsB = await listFilePaths(ctx.sessionVfs(project.id, sessionB.id));
    assert.deepEqual(pathsA, pathsB);
    assert.deepEqual(pathsA, ["/alpha.md", "/dir/beta.md"]);
  });

  it("phase A invalid UTF-8 does not reach deleteVfsPrefix", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-val-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    let deleteReached = false;
    const zipSvc = createVfsZipIoService(ctx.conn, {
      testHook: {
        onBeforeDeletePrefix: () => {
          deleteReached = true;
        },
      },
    });
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
    assert.equal(deleteReached, false);
  });

  it("phase A parent-segment path does not reach deleteVfsPrefix", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-path-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    let deleteReached = false;
    const zipSvc = createVfsZipIoService(ctx.conn, {
      testHook: {
        onBeforeDeletePrefix: () => {
          deleteReached = true;
        },
      },
    });
    const zipWithParent = zipSync({
      "../escape.md": new TextEncoder().encode("x"),
    });
    await assert.rejects(
      () =>
        zipSvc.import(
          { kind: "session", projectId: project.id, sessionId: session.id },
          zipWithParent,
          { confirmed: true },
        ),
      (e: unknown) =>
        e instanceof VfsZipError && e.code === "INVALID_PATH",
    );
    assert.equal(deleteReached, false);
  });

  it("project scope export round-trips template tree", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P2-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/t.md", "T");

    const zipSvc = createVfsZipIoService(ctx.conn);
    const bytes = await zipSvc.export({ kind: "project", projectId: project.id });
    const names = Object.keys(unzipSync(bytes));
    assert.ok(names.includes("t.md"));

    await zipSvc.import(
      { kind: "project", projectId: project.id },
      buildVfsZip(new Map([["t.md", "T2"]])),
      { confirmed: true },
    );
    const read = await pvfs.read("/t.md");
    assert.equal(read.content, "T2");
  });

  it("skips __MACOSX and .DS_Store junk entries on import", async () => {
    const ctx = getNovelMasterTestContext();
    const zip = buildVfsZip(
      new Map([
        ["readme.md", "ok"],
        ["__MACOSX/._readme.md", ""],
        [".DS_Store", ""],
      ]),
    );
    const zipSvc = createVfsZipIoService(ctx.conn);
    await zipSvc.import({ kind: "global" }, zip, { confirmed: true });
    const paths = await listFilePaths(ctx.globalVfs());
    assert.deepEqual(paths, ["/readme.md"]);
  });

  it("session ZIP imports into project template scope", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-zip-cross-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const content = "你好";
    await svfs.write("/ddd/love_message.txt", content);

    const zipSvc = createVfsZipIoService(ctx.conn);
    const zipBytes = await zipSvc.export({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });

    await zipSvc.import(
      { kind: "project", projectId: project.id },
      zipBytes,
      { confirmed: true },
    );

    const pvfs = ctx.projectVfs(project.id);
    const read = await pvfs.read("/ddd/love_message.txt");
    assert.equal(read.content, content);
  });

  it("Z-buildZip-1: custom builder receives gather output once", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-buildZip-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/a.md", "A");
    await vfs.write("/dir/b.md", "B");

    let callCount = 0;
    const zipSvc = createVfsZipIoService(ctx.conn, {
      buildZip: (input) => {
        callCount += 1;
        assert.equal(input.files.get("a.md"), "A");
        assert.equal(input.files.get("dir/b.md"), "B");
        assert.ok(!input.files.has("/a.md"));
        return buildVfsZip(input.files, input.directoryEntryNames);
      },
    });

    await zipSvc.export({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    assert.equal(callCount, 1);
  });

  it("Z-buildZip-2: custom builder return value is export result", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-buildZip2-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/x.md", "x");

    const magic = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const zipSvc = createVfsZipIoService(ctx.conn, {
      buildZip: () => magic,
    });
    const bytes = await zipSvc.export({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    assert.deepEqual(bytes, magic);
  });

  it("Z-buildZip-3: without buildZip, session export paths match Z1", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-buildZip3-${testIsolationSuffix()}`);
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
  });
});
