import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unzipSync, zipSync } from "fflate";
import { createVfsZipIoService, VfsZipError } from "@novel-master/core/vfs";
import {
  createCharacterCardImportService,
  parseCharacterCardToMdTree,
  type VfsService,
} from "@novel-master/core/vfs";
import { buildVfsZip } from "../../src/domain/vfs/logic/vfs-zip-build.js";
import { createWorkplaceService } from "@novel-master/core/workplace";
import { SqliteWorkplaceRepository } from "../../src/domain/workplace/repositories/impl/sqlite-workplace.repository.js";
import { decodeUtf8Entry } from "../../src/domain/vfs/logic/vfs-zip-validate.js";
import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import { sessionApiPromptTokenCache } from "../../src/infra/tokenizer/logic/session-api-prompt-token-cache.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";
import { buildGbkFilenameZip } from "./helpers/gbk-zip-fixture.js";


async function listFilePaths(vfs: VfsService, dir = "/"): Promise<string[]> {
  const entries = await vfs.list(dir, { recursive: true });
  return entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.path)
    .sort();
}


novelMasterTestFixture();

describe("VfsZipIoService", () => {
  it("T-IO1: ZIP 导出仍为明文文件内容（不出现 null 伪串）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/plain.md", "中文正文-zip-io1");
    await vfs.write("/empty.md", "");

    const zipSvc = createVfsZipIoService(ctx.conn);
    const bytes = await zipSvc.export({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const entries = unzipSync(bytes);
    assert.equal(
      new TextDecoder().decode(entries["plain.md"]!),
      "中文正文-zip-io1",
    );
    assert.equal(new TextDecoder().decode(entries["empty.md"]!), "");
    assert.notEqual(
      new TextDecoder().decode(entries["plain.md"]!),
      "null",
    );
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

  it("Z8: GBK 中文路径 ZIP 导入后列表路径正确", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-z8-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const logicalPath = "笔记/第一章.md";
    const zipBytes = buildGbkFilenameZip([
      { logicalPath, content: "GBK 正文" },
    ]);

    const zipSvc = createVfsZipIoService(ctx.conn);
    await zipSvc.import(scope, zipBytes, { confirmed: true });

    const paths = await listFilePaths(vfs);
    assert.deepEqual(paths, [`/${logicalPath}`]);
    assert.equal((await vfs.read(`/${logicalPath}`)).content, "GBK 正文");
  });

  it("Z9: GBK ZIP 全量覆盖后无旧文件残留", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-z9-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.write("/old.md", "旧内容");

    const zipBytes = buildGbkFilenameZip([{ logicalPath: "new.md", content: "新内容" }]);
    const zipSvc = createVfsZipIoService(ctx.conn);
    await zipSvc.import(scope, zipBytes, { confirmed: true });

    const paths = await listFilePaths(vfs);
    assert.deepEqual(paths, ["/new.md"]);
    await assert.rejects(() => vfs.read("/old.md"));
    assert.equal((await vfs.read("/new.md")).content, "新内容");
  });

  it("T-Z1: directoryPath 缺省 ≡ /，行为同旧整域替换", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tz1-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.write("/old.md", "old");

    const zipSvc = createVfsZipIoService(ctx.conn);
    await zipSvc.import(scope, buildVfsZip(new Map([["new.md", "new"]])), {
      confirmed: true,
    });

    await assert.rejects(() => vfs.read("/old.md"));
    assert.equal((await vfs.read("/new.md")).content, "new");
  });

  it("T-Z2: 导出 /a 时 ZIP 无 /b 内容", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tz2-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.write("/a/foo.txt", "A");
    await vfs.write("/b/bar.txt", "B");

    const zipSvc = createVfsZipIoService(ctx.conn);
    const bytes = await zipSvc.export(scope, { directoryPath: "/a" });
    const names = Object.keys(unzipSync(bytes));
    assert.ok(names.includes("foo.txt"), `got ${names.join(",")}`);
    assert.ok(!names.includes("bar.txt"));
    assert.ok(!names.some((n) => n.includes("b/")));
  });

  it("T-Z3: 导入 /a 后 /b 不变且 /a 与 ZIP 一致", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tz3-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.write("/a/old.txt", "old");
    await vfs.write("/b/keep.txt", "keep");

    const zipSvc = createVfsZipIoService(ctx.conn);
    await zipSvc.import(scope, buildVfsZip(new Map([["fresh.txt", "fresh"]])), {
      confirmed: true,
      directoryPath: "/a",
    });

    await assert.rejects(() => vfs.read("/a/old.txt"));
    assert.equal((await vfs.read("/a/fresh.txt")).content, "fresh");
    assert.equal((await vfs.read("/b/keep.txt")).content, "keep");
  });

  it("T-Z4: confirmed:false / 非法 UTF-8 → 子树与兄弟均不变", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tz4-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.write("/a/stay.txt", "stay-a");
    await vfs.write("/b/stay.txt", "stay-b");

    const zipSvc = createVfsZipIoService(ctx.conn);
    await assert.rejects(
      () =>
        zipSvc.import(scope, buildVfsZip(new Map([["x.txt", "x"]])), {
          confirmed: false,
          directoryPath: "/a",
        }),
      (e: unknown) => e instanceof VfsZipError && e.code === "NOT_CONFIRMED",
    );

    const invalidUtf8Zip = zipSync({
      "bad.md": new Uint8Array([0xff, 0xfe, 0x80]),
    });
    await assert.rejects(
      () =>
        zipSvc.import(scope, invalidUtf8Zip, {
          confirmed: true,
          directoryPath: "/a",
        }),
      (e: unknown) => e instanceof VfsZipError && e.code === "INVALID_UTF8",
    );

    assert.equal((await vfs.read("/a/stay.txt")).content, "stay-a");
    assert.equal((await vfs.read("/b/stay.txt")).content, "stay-b");
  });

  it("T-Z5: 恶意 ../ entry → 失败不删子树", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tz5-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.write("/a/keep.txt", "keep");
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
        zipSvc.import(scope, zipWithParent, {
          confirmed: true,
          directoryPath: "/a",
        }),
      (e: unknown) => e instanceof VfsZipError && e.code === "INVALID_PATH",
    );
    assert.equal(deleteReached, false);
    assert.equal((await vfs.read("/a/keep.txt")).content, "keep");
  });

  it("T-Z6: directoryPath=/a 且 entries 全为首段 a/... → INVALID_PATH，子树不变", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tz6-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.write("/a/keep.txt", "keep");
    let deleteReached = false;
    const zipSvc = createVfsZipIoService(ctx.conn, {
      testHook: {
        onBeforeDeletePrefix: () => {
          deleteReached = true;
        },
      },
    });
    await assert.rejects(
      () =>
        zipSvc.import(
          scope,
          buildVfsZip(
            new Map([
              ["a/foo.txt", "foo"],
              ["a/bar.md", "bar"],
            ]),
          ),
          { confirmed: true, directoryPath: "/a" },
        ),
      (e: unknown) => e instanceof VfsZipError && e.code === "INVALID_PATH",
    );
    assert.equal(deleteReached, false);
    assert.equal((await vfs.read("/a/keep.txt")).content, "keep");
    await assert.rejects(() => vfs.read("/a/a/foo.txt"));
  });

  it("directoryPath 指向 file 时 export/import 均 INVALID_PATH", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-file-path-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.write("/note.md", "note");

    const zipSvc = createVfsZipIoService(ctx.conn);
    const assertInvalidPath = (e: unknown) =>
      e instanceof VfsZipError && e.code === "INVALID_PATH";

    await assert.rejects(
      () => zipSvc.export(scope, { directoryPath: "/note.md" }),
      assertInvalidPath,
    );
    await assert.rejects(
      () =>
        zipSvc.import(scope, buildVfsZip(new Map([["x.txt", "x"]])), {
          confirmed: true,
          directoryPath: "/note.md",
        }),
      assertInvalidPath,
    );
    assert.equal((await vfs.read("/note.md")).content, "note");
  });

  it("空 ZIP 导入非根子树仍保留目标目录行", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-empty-sub-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.mkdir("/a");
    await vfs.write("/a/old.txt", "old");
    await vfs.write("/b/sib.txt", "sib");

    const zipSvc = createVfsZipIoService(ctx.conn);
    await zipSvc.import(scope, buildVfsZip(new Map()), {
      confirmed: true,
      directoryPath: "/a",
    });

    const rootEntries = await vfs.list("/", { recursive: false });
    assert.ok(
      rootEntries.some((e) => e.kind === "directory" && e.path === "/a"),
      "empty ZIP import should retain /a directory row",
    );
    await assert.rejects(() => vfs.read("/a/old.txt"));
    assert.equal((await vfs.read("/b/sib.txt")).content, "sib");
  });

  it("T-Z7: directoryPath=/a 且 entries 为 foo.txt（首段 ≠ a）→ 导入成功", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tz7-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.write("/a/old.txt", "old");
    await vfs.write("/b/sib.txt", "sib");

    const zipSvc = createVfsZipIoService(ctx.conn);
    await zipSvc.import(scope, buildVfsZip(new Map([["foo.txt", "foo"]])), {
      confirmed: true,
      directoryPath: "/a",
    });

    assert.equal((await vfs.read("/a/foo.txt")).content, "foo");
    await assert.rejects(() => vfs.read("/a/old.txt"));
    assert.equal((await vfs.read("/b/sib.txt")).content, "sib");
  });

  it("T-IC2: session scope ZIP 导入后清空 rule_snapshot/file_cache 并失效 token cache", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tic2-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

    await ctx.sessionKkv.set(
      session.id,
      SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      "canon",
      "snap",
    );
    await ctx.sessionKkv.set(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      "full:/a.md",
      "a",
    );
    sessionApiPromptTokenCache.set(session.id, {
      promptTokens: 88,
      updatedAt: Date.now(),
    });

    const zipSvc = createVfsZipIoService(ctx.conn);
    await zipSvc.import(scope, buildVfsZip(new Map([["a.md", "zip-a"]])), {
      confirmed: true,
    });

    assert.equal((await vfs.read("/a.md")).content, "zip-a");
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT),
      [],
    );
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_FILE_CACHE),
      [],
    );
    assert.equal(sessionApiPromptTokenCache.get(session.id), undefined);
  });

  it("T-IC3: global scope ZIP 导入后 session KKV 与 token cache 均不动", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tic3z-${testIsolationSuffix()}`);
    // session 仅用来埋脏数据；导入走 global scope（非 session kind，三件套不触发）
    const session = await ctx.sessions.create(project.id);

    await ctx.sessionKkv.set(
      session.id,
      SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      "canon",
      "snap",
    );
    await ctx.sessionKkv.set(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      "full:/a.md",
      "a",
    );
    sessionApiPromptTokenCache.set(session.id, {
      promptTokens: 12,
      updatedAt: Date.now(),
    });

    const zipSvc = createVfsZipIoService(ctx.conn);
    await zipSvc.import(
      { kind: "global" },
      buildVfsZip(new Map([["readme.md", "global-r"]])),
      { confirmed: true },
    );

    assert.equal((await ctx.globalVfs().read("/readme.md")).content, "global-r");
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT),
      ["canon"],
    );
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_FILE_CACHE),
      ["full:/a.md"],
    );
    assert.ok(sessionApiPromptTokenCache.get(session.id) != null);
  });

  it("T-IC5: 两个工厂单参可构造且 sessionKkv 已内部装配（对外签名回归钉死）", async () => {
    const ctx = getNovelMasterTestContext();
    // 单参构造不抛（mobile 测试钉死 calls[0]?.[1] === undefined 的签名契约）
    const zipSvc = createVfsZipIoService(ctx.conn);
    const cardSvc = createCharacterCardImportService(ctx.conn);
    assert.equal(typeof zipSvc.import, "function");
    assert.equal(typeof cardSvc.import, "function");

    // 内部装配行为验证：单参工厂创建的服务导入后三件套对齐生效
    const project = await ctx.projects.create(`P-tic5-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await ctx.sessionKkv.set(
      session.id,
      SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      "canon",
      "snap",
    );
    sessionApiPromptTokenCache.set(session.id, {
      promptTokens: 5,
      updatedAt: Date.now(),
    });
    await zipSvc.import(scope, buildVfsZip(new Map([["b.md", "b"]])), {
      confirmed: true,
    });
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT),
      [],
    );
    assert.equal(sessionApiPromptTokenCache.get(session.id), undefined);

    const session2 = await ctx.sessions.create(project.id);
    const scope2 = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session2.id,
    };
    await ctx.sessionKkv.set(
      session2.id,
      SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      "canon",
      "snap",
    );
    await cardSvc.import(
      scope2,
      parseCharacterCardToMdTree(
        JSON.stringify({
          spec: "chara_card_v2",
          data: { description: "d" },
        }),
      ),
      { confirmed: true, directoryPath: "/角色" },
    );
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(
        session2.id,
        SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      ),
      [],
    );
  });

  it("T-I2: ZIP 导入后前缀下全部目录（显式 directories 与隐式父链、深嵌套）默认启用并参与裁剪", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

    const zipSvc = createVfsZipIoService(ctx.conn);
    // 显式 directories（"设定集/"）+ 文件路径隐式父链（世界书/章节/深层）
    await zipSvc.import(
      scope,
      buildVfsZip(
        new Map([
          ["设定集/显式目录条目.md", "显式"],
          ["世界书/章节/深层/设定.md", "深层设定"],
        ]),
        ["设定集/"],
      ),
      { confirmed: true, directoryPath: "/角色" },
    );

    const wt = createWorkplaceService(ctx.conn, scope);
    for (const dir of [
      "/角色",
      "/角色/设定集",
      "/角色/世界书",
      "/角色/世界书/章节",
      "/角色/世界书/章节/深层",
    ]) {
      const rule = await wt.getDirRule(dir);
      assert.ok(rule, `${dir} 应有默认规则行`);
      assert.equal(rule.ruleEnabled, true, `${dir} 应默认启用`);
      assert.equal(rule.headCount, 0);
      assert.equal(rule.tailCount, 1000);
      assert.equal(rule.fillPolicy, "header");
      // T-I4 同口径：补入行落在 workplace 键空间
      assert.equal(rule.scopeKey, `session:${session.id}`);
    }

    // 经文件树视图确认导入目录参与裁剪
    const view = await wt.materializeLiveView();
    assert.ok(view.filetreeDisplay.includes("设定.md"));
    assert.ok(view.filetreeDisplay.includes("显式目录条目.md"));
    assert.equal(
      (await vfs.read("/角色/世界书/章节/深层/设定.md")).content,
      "深层设定",
    );
  });

  it("T-I3: ZIP 导入后已有规则行（rule_off 与自定义 headCount）不被覆盖", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

    // 预置：目标目录自定义 headCount:7；子目录 rule_off
    const wt = createWorkplaceService(ctx.conn, scope);
    await wt.setDirRule({
      logicalPath: "/角色",
      sortField: "name",
      sortOrder: "asc",
      headCount: 7,
      tailCount: 1,
      fillPolicy: "filename",
    });
    await wt.setDirRule({ logicalPath: "/角色/世界书", ruleEnabled: false });

    const zipSvc = createVfsZipIoService(ctx.conn);
    await zipSvc.import(
      scope,
      buildVfsZip(new Map([["世界书/设定.md", "设定"]])),
      { confirmed: true, directoryPath: "/角色" },
    );

    const after = await wt.getDirRule("/角色");
    assert.ok(after);
    assert.equal(after.headCount, 7);
    assert.equal(after.fillPolicy, "filename");
    const worldbook = await wt.getDirRule("/角色/世界书");
    assert.ok(worldbook);
    assert.equal(worldbook.ruleEnabled, false);
  });

  it("T-Z8: 导入到根——前缀下子目录补默认启用行、根自身 / 无规则行", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tz8-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

    // directoryPath 缺省即根（CLI import-zip 不带 --path 的主场景）
    const zipSvc = createVfsZipIoService(ctx.conn);
    await zipSvc.import(
      scope,
      buildVfsZip(
        new Map([
          ["设定集/显式目录条目.md", "显式"],
          ["世界书/章节/深层/设定.md", "深层设定"],
        ]),
        ["设定集/"],
      ),
      { confirmed: true, directoryPath: "/" },
    );

    const wt = createWorkplaceService(ctx.conn, scope);
    for (const dir of [
      "/设定集",
      "/世界书",
      "/世界书/章节",
      "/世界书/章节/深层",
    ]) {
      const rule = await wt.getDirRule(dir);
      assert.ok(rule, `${dir} 应有默认规则行`);
      assert.equal(rule.ruleEnabled, true, `${dir} 应默认启用`);
      assert.equal(rule.headCount, 0);
      assert.equal(rule.tailCount, 1000);
      assert.equal(rule.fillPolicy, "header");
      assert.equal(rule.scopeKey, `session:${session.id}`);
    }
    // 根自身 / 不补规则行
    assert.equal(await wt.getDirRule("/"), undefined);
    assert.equal(
      (await vfs.read("/世界书/章节/深层/设定.md")).content,
      "深层设定",
    );
  });

});
