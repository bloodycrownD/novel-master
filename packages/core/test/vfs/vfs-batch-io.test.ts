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
