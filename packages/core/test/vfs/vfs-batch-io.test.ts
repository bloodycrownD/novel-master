import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createVfsBatchIoService } from "@novel-master/core/vfs";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("VfsBatchIoService", () => {
  it("T-B1: ingest two files into /chap keeps siblings", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const vfs = ctx.projectVfs(project.id);
    await vfs.write("/keep.md", "keep");
    await vfs.mkdir("/chap");

    const batch = createVfsBatchIoService(ctx.conn);
    const scope = { kind: "project" as const, projectId: project.id };
    const plan = await batch.planBatchIngest(scope, "/chap", [
      { kind: "file", relativePath: "a.md", bytes: enc("A") },
      { kind: "file", relativePath: "b.md", bytes: enc("B") },
    ]);
    const report = await batch.applyBatchIngest(scope, "/chap", plan, {
      overwriteConfirmed: false,
    });

    assert.deepEqual(report.written.sort(), ["/chap/a.md", "/chap/b.md"]);
    assert.equal(report.failed.length, 0);
    assert.equal((await vfs.read("/keep.md")).content, "keep");
    assert.equal((await vfs.read("/chap/a.md")).content, "A");
  });

  it("T-B2: conflicts without confirm → zero writes", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const vfs = ctx.projectVfs(project.id);
    await vfs.write("/chap/a.md", "old");

    const batch = createVfsBatchIoService(ctx.conn);
    const scope = { kind: "project" as const, projectId: project.id };
    const plan = await batch.planBatchIngest(scope, "/chap", [
      { kind: "file", relativePath: "a.md", bytes: enc("new") },
    ]);
    assert.equal(plan.conflicts.length, 1);
    const report = await batch.applyBatchIngest(scope, "/chap", plan, {
      overwriteConfirmed: false,
    });
    assert.deepEqual(report.written, []);
    assert.ok(report.skipped.includes("/chap/a.md"));
    assert.equal((await vfs.read("/chap/a.md")).content, "old");
  });

  it("T-B3: invalid UTF-8 goes to skipped, not written", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const vfs = ctx.projectVfs(project.id);

    const bad = new Uint8Array([0xff, 0xfe, 0xfd]);
    const batch = createVfsBatchIoService(ctx.conn);
    const scope = { kind: "project" as const, projectId: project.id };
    const plan = await batch.planBatchIngest(scope, "/", [
      { kind: "file", relativePath: "bad.bin", bytes: bad },
      { kind: "file", relativePath: "ok.md", bytes: enc("ok") },
    ]);
    assert.ok(plan.skippedBinary.includes("bad.bin"));
    assert.equal(plan.writes.length, 1);
    const report = await batch.applyBatchIngest(scope, "/", plan, {
      overwriteConfirmed: false,
    });
    assert.deepEqual(report.written, ["/ok.md"]);
    assert.ok(report.skipped.includes("bad.bin"));
    await assert.rejects(() => vfs.read("/bad.bin"));
  });

  it("T-B4: empty directory entry creates directory node", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const vfs = ctx.projectVfs(project.id);

    const batch = createVfsBatchIoService(ctx.conn);
    const scope = { kind: "project" as const, projectId: project.id };
    const plan = await batch.planBatchIngest(scope, "/", [
      { kind: "directory", relativePath: "empty" },
    ]);
    assert.deepEqual(plan.mkdirPaths, ["/empty"]);
    await batch.applyBatchIngest(scope, "/", plan, { overwriteConfirmed: false });

    const listed = await vfs.list("/", { recursive: false });
    const empty = listed.find((e) => e.path === "/empty");
    assert.ok(empty);
    assert.equal(empty.kind, "directory");
  });

  it("T-B5: export plan keeps relative structure", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const vfs = ctx.projectVfs(project.id);
    await vfs.write("/chap/a.md", "A");
    await vfs.write("/chap/sub/b.md", "B");

    const batch = createVfsBatchIoService(ctx.conn);
    const plan = await batch.planBatchExport(
      { kind: "project", projectId: project.id },
      ["/chap"],
    );
    const rels = plan.files.map((f) => f.relativePath).sort();
    assert.deepEqual(rels, ["a.md", "sub/b.md"]);
  });

  it("T-B10: 多选两个同名文件（不同父目录）都要进 plan", async () => {
    // 牙齿：把锚点改回 `basenameOf(logical)` 这条立刻红（files.length === 1，
    // 第二条被 seenFileRels 静默丢弃 ⇒ ZIP 少一个文件且 UI 零提示）。
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const vfs = ctx.projectVfs(project.id);
    await vfs.write("/卷一/第一章.md", "A");
    await vfs.write("/卷二/第一章.md", "B");

    const batch = createVfsBatchIoService(ctx.conn);
    const plan = await batch.planBatchExport(
      { kind: "project", projectId: project.id },
      ["/卷一/第一章.md", "/卷二/第一章.md"],
    );
    const rels = plan.files.map((f) => f.relativePath);
    assert.equal(plan.files.length, 2);
    assert.equal(new Set(rels).size, 2, "两个 relativePath 必须互不相同");
    assert.deepEqual([...rels].sort(), ["卷一/第一章.md", "卷二/第一章.md"]);
  });

  it("T-B11: 单选一个文件仍导出该文件（防锚点取父目录改错）", async () => {
    // 陷阱专测：`relativePathUnderAnchor(p, p)` 按定义返回空串 ⇒ 任何「锚点用自身」
    // 的错修都会让单选文件被 `rel.length === 0` 整条丢掉。
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const vfs = ctx.projectVfs(project.id);
    await vfs.write("/卷一/第一章.md", "A");

    const batch = createVfsBatchIoService(ctx.conn);
    const plan = await batch.planBatchExport(
      { kind: "project", projectId: project.id },
      ["/卷一/第一章.md"],
    );
    assert.equal(plan.files.length, 1);
    assert.equal(plan.files[0]!.relativePath, "第一章.md");
  });

  it("T-B12: 同名冲突进入 skipped 通道", async () => {
    // 「文件 + 同名目录同选」仍会撞 rel（文件分支得 `卷一/a.md`、目录分支也得
    // `卷一/a.md`）——skipped 是**必需通道**、不是死字段。
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const vfs = ctx.projectVfs(project.id);
    await vfs.write("/卷一/a.md", "单文件");
    await vfs.write("/卷一/子/b.md", "目录里的");

    const batch = createVfsBatchIoService(ctx.conn);
    const plan = await batch.planBatchExport(
      { kind: "project", projectId: project.id },
      // 单文件在前 ⇒ 它先占住 `卷一/a.md`；随后目录分支再产出同 rel ⇒ 撞名
      ["/卷一/a.md", "/卷一"],
    );
    const rels = plan.files.map((f) => f.relativePath);
    assert.equal(new Set(rels).size, rels.length, "plan.files 不得含重复项");
    assert.equal((plan.skipped ?? []).length, 1, "被去重的那条必须进 skipped");
    assert.equal(plan.skipped![0]!.logicalPath, "/卷一/a.md");
    assert.equal(plan.skipped![0]!.reason, "DUPLICATE_RELATIVE_PATH");
  });

  it("T-B6: mid-apply failure rolls back entire non-session batch", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const vfs = ctx.projectVfs(project.id);

    const batch = createVfsBatchIoService(ctx.conn, {
      testHook: { throwOnWriteLogical: "/chap/b.md" },
    });
    const scope = { kind: "project" as const, projectId: project.id };
    const plan = await batch.planBatchIngest(scope, "/chap", [
      { kind: "file", relativePath: "a.md", bytes: enc("A") },
      { kind: "file", relativePath: "b.md", bytes: enc("B") },
    ]);
    const report = await batch.applyBatchIngest(scope, "/chap", plan, {
      overwriteConfirmed: false,
    });
    assert.deepEqual(report.written, []);
    assert.ok(report.failed.length >= 1);
    await assert.rejects(() => vfs.read("/chap/a.md"));
    await assert.rejects(() => vfs.read("/chap/b.md"));
  });

  it("T-B7: plan detects same-path file/directory type conflict", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const batch = createVfsBatchIoService(ctx.conn);
    const scope = { kind: "project" as const, projectId: project.id };
    const plan = await batch.planBatchIngest(scope, "/", [
      { kind: "file", relativePath: "foo", bytes: enc("file") },
      { kind: "directory", relativePath: "foo" },
    ]);
    assert.equal(plan.typeConflicts.length, 1);
    assert.match(plan.typeConflicts[0]!.message, /both file and directory/);
    const report = await batch.applyBatchIngest(scope, "/", plan, {
      overwriteConfirmed: false,
    });
    assert.deepEqual(report.written, []);
    assert.equal(report.failed.length, 1);
  });

  it("T-B9: plan detects file-under-file type conflict", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const batch = createVfsBatchIoService(ctx.conn);
    const scope = { kind: "project" as const, projectId: project.id };
    const plan = await batch.planBatchIngest(scope, "/", [
      { kind: "file", relativePath: "foo", bytes: enc("parent") },
      { kind: "file", relativePath: "foo/bar.txt", bytes: enc("child") },
    ]);
    assert.equal(plan.typeConflicts.length, 1);
    assert.match(plan.typeConflicts[0]!.message, /under file/);
    const report = await batch.applyBatchIngest(scope, "/", plan, {
      overwriteConfirmed: false,
    });
    assert.deepEqual(report.written, []);
    assert.equal(report.failed.length, 1);
  });

  it("T-B8: session writer keeps first success when second fails", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const vfs = ctx.projectVfs(project.id);

    const batch = createVfsBatchIoService(ctx.conn);
    const scope = { kind: "project" as const, projectId: project.id };
    const plan = await batch.planBatchIngest(scope, "/chap", [
      { kind: "file", relativePath: "a.md", bytes: enc("A") },
      { kind: "file", relativePath: "b.md", bytes: enc("B") },
    ]);

    const writtenViaWriter: string[] = [];
    const report = await batch.applyBatchIngestWithWriter(
      "/chap",
      plan,
      { overwriteConfirmed: false },
      {
        async mkdir() {},
        async writeFile(logical, content) {
          if (logical.endsWith("/b.md")) {
            throw new Error("simulated write fail");
          }
          await vfs.write(logical, content, { versionCheck: false });
          writtenViaWriter.push(logical);
        },
      },
    );

    assert.deepEqual(report.written, ["/chap/a.md"]);
    assert.equal(report.failed.length, 1);
    assert.equal((await vfs.read("/chap/a.md")).content, "A");
    await assert.rejects(() => vfs.read("/chap/b.md"));
    assert.deepEqual(writtenViaWriter, ["/chap/a.md"]);
  });
});
