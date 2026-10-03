import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createScopedVfsService, createVfsBatchIoService } from "@novel-master/core/vfs";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import { DefaultVfsBatchIoService } from "../../src/service/vfs/impl/vfs-batch-io.service.js";
import { SqliteVfsEntryRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";
import {
  probeTransactions,
  type TransactionProbe,
} from "../helpers/transaction-probe.js";
import { createMemorySessionKkv } from "../helpers/prompt-layout-test-helpers.js";
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

  // CS-05 分片提交后的失败语义：**已提交分片保留、失败片回滚**。
  // 用例名里的「整事务回滚」按新口径换掉——否则后来者会按名字误判语义
  // （旧形态确实是一条事务，现在是一条事务 per ≤200 文件）。
  // 「2 文件同片失败 ⇒ written=[]」是**同片**形态：第 1 片就抛，没有任何已提交片。
  it("T-B6: 同片内失败 → written 为空、失败片整体回滚", async () => {
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
    assert.deepEqual(report.written, [], "失败发生在第 1 片，无已提交分片");
    assert.ok(report.failed.length >= 1);
    // failed[0].path 报的是**失败片的首个 logical**（不是真正抛错的那条）。
    assert.equal(report.failed[0]!.path, "/chap/a.md");
    await assert.rejects(() => vfs.read("/chap/a.md"));
    await assert.rejects(() => vfs.read("/chap/b.md"));
  });

  // A-8 契约（主差分断言）：跨片失败时 `written` 必须**如实报告已提交分片**。
  // 旧实现的 report 恒为 `written: []`（那次失败把已 push 的 logical 整个丢弃
  // ⇒ 报告对用户说谎：声称一个都没写，实际写了 200 个）。
  it("T-B6b: 跨片失败 → written 等于已提交分片，failed[0].path 是失败片首个 logical", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const vfs = ctx.projectVfs(project.id);

    const total = 401;
    const failIndex = 200; // 第 2 片（0-based）的首个文件
    const failLogical = `/chap/f${String(failIndex).padStart(4, "0")}.md`;
    const batch = createVfsBatchIoService(ctx.conn, {
      testHook: { throwOnWriteLogical: failLogical },
    });
    const scope = { kind: "project" as const, projectId: project.id };
    const entries = Array.from({ length: total }, (_, i) => ({
      kind: "file" as const,
      relativePath: `f${String(i).padStart(4, "0")}.md`,
      bytes: enc(`B${i}`),
    }));
    const plan = await batch.planBatchIngest(scope, "/chap", entries);
    assert.equal(plan.writes.length, total);

    const report = await batch.applyBatchIngest(scope, "/chap", plan, {
      overwriteConfirmed: false,
    });

    // 第 1 片 200 个全部提交 ⇒ 必须在 written 里，且顺序稳定。
    const expectedCommitted = entries
      .slice(0, 200)
      .map((e) => `/chap/${e.relativePath}`);
    assert.deepEqual(report.written, expectedCommitted);
    assert.equal(report.failed.length, 1);
    assert.equal(report.failed[0]!.path, failLogical);

    // 未到失败片的文件不得出现在 written 里（反向断言）。
    for (let i = failIndex; i < total; i++) {
      assert.ok(
        !report.written.includes(`/chap/f${String(i).padStart(4, "0")}.md`),
        `f${i} 未提交，不得进 written`
      );
    }
    // 第 1 片确实落库可读。
    assert.equal((await vfs.read(expectedCommitted[0]!)).content, "B0");
    await assert.rejects(() => vfs.read(failLogical));
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
      scope,
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

/**
 * R5：session scope 导入成功后清空提示词缓存（rule_snapshot + file_cache）。
 *
 * 口径「有成功写入才清」——**零写入**早退（typeConflicts / 冲突未确认 / 同片失败）不清；
 * 分片失败只要有已提交分片就清（清理排在 failedPath 早退之前）；
 * 清理是 best-effort（helper 自吞错）。与 zip / 角色卡导入的既有范式同款。
 */
describe("VfsBatchIoService 导入后清 session 提示词缓存", () => {
  /** 预置两域脏数据，返回 session scope 与 kkv 上的取值函数。 */
  async function seedDirtyCaches(
    sessionId: string,
    tag: string,
  ): Promise<{ ruleKeys: string[]; fileKeys: string[] }> {
    const ctx = getNovelMasterTestContext();
    await ctx.sessionKkv.set(
      sessionId,
      SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      `${tag}:canon`,
      "snap",
    );
    await ctx.sessionKkv.set(
      sessionId,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      `${tag}:full:/a.md`,
      "a",
    );
    return {
      ruleKeys: await ctx.sessionKkv.listKeys(
        sessionId,
        SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      ),
      fileKeys: await ctx.sessionKkv.listKeys(
        sessionId,
        SESSION_KKV_DOMAIN_FILE_CACHE,
      ),
    };
  }

  it("T-C1: session scope applyBatchIngest 成功后两域被清空", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tc1-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

    const seeded = await seedDirtyCaches(session.id, "tc1");
    assert.deepEqual(seeded.ruleKeys, ["tc1:canon"]);
    assert.deepEqual(seeded.fileKeys, ["tc1:full:/a.md"]);

    const batch = new DefaultVfsBatchIoService(
      ctx.conn,
      new SqliteVfsEntryRepository(ctx.conn),
      { sessionKkv: ctx.sessionKkv },
    );
    const plan = await batch.planBatchIngest(scope, "/导入", [
      { kind: "file", relativePath: "a.md", bytes: enc("A") },
    ]);
    const report = await batch.applyBatchIngest(scope, "/导入", plan, {
      overwriteConfirmed: false,
    });

    assert.deepEqual(report.written, ["/导入/a.md"]);
    assert.equal((await vfs.read("/导入/a.md")).content, "A");
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT),
      [],
    );
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_FILE_CACHE),
      [],
    );
  });

  it("T-C2: project scope 导入成功后两域不动", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tc2-${testIsolationSuffix()}`);
    // session 只用来埋脏数据：验证走 project scope 时缓存对齐门闸不触发
    const session = await ctx.sessions.create(project.id);
    const pvfs = ctx.projectVfs(project.id);

    const seeded = await seedDirtyCaches(session.id, "tc2");
    assert.deepEqual(seeded.ruleKeys, ["tc2:canon"]);

    const batch = new DefaultVfsBatchIoService(
      ctx.conn,
      new SqliteVfsEntryRepository(ctx.conn),
      { sessionKkv: ctx.sessionKkv },
    );
    const scope = { kind: "project" as const, projectId: project.id };
    const plan = await batch.planBatchIngest(scope, "/导入", [
      { kind: "file", relativePath: "a.md", bytes: enc("A") },
    ]);
    const report = await batch.applyBatchIngest(scope, "/导入", plan, {
      overwriteConfirmed: false,
    });

    assert.deepEqual(report.written, ["/导入/a.md"]);
    assert.equal((await pvfs.read("/导入/a.md")).content, "A");
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT),
      ["tc2:canon"],
    );
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_FILE_CACHE),
      ["tc2:full:/a.md"],
    );
  });

  it("T-C3: sessionKkv 抛错时导入仍成功返回（best-effort 吞错）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tc3-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

    const throwingKkv = Object.assign(createMemorySessionKkv(), {
      clearDomain: async (): Promise<void> => {
        throw new Error("kkv-boom");
      },
    });
    const batch = new DefaultVfsBatchIoService(
      ctx.conn,
      new SqliteVfsEntryRepository(ctx.conn),
      { sessionKkv: throwingKkv },
    );

    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };
    let report:
      | Awaited<ReturnType<typeof batch.applyBatchIngest>>
      | undefined;
    try {
      const plan = await batch.planBatchIngest(scope, "/导入", [
        { kind: "file", relativePath: "a.md", bytes: enc("A") },
      ]);
      await assert.doesNotReject(async () => {
        report = await batch.applyBatchIngest(scope, "/导入", plan, {
          overwriteConfirmed: false,
        });
      });
    } finally {
      console.warn = originalWarn;
    }

    // 导入本体已落库；缓存对齐失败只 warn 留痕
    assert.deepEqual(report!.written, ["/导入/a.md"]);
    assert.equal((await vfs.read("/导入/a.md")).content, "A");
    assert.ok(warnCalls.length >= 1);
  });

  it("T-C4: 冲突未确认早退不清缓存；确认覆盖成功后清理", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tc4-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.write("/导入/a.md", "old");

    const batch = new DefaultVfsBatchIoService(
      ctx.conn,
      new SqliteVfsEntryRepository(ctx.conn),
      { sessionKkv: ctx.sessionKkv },
    );
    const plan = await batch.planBatchIngest(scope, "/导入", [
      { kind: "file", relativePath: "a.md", bytes: enc("new") },
    ]);
    assert.equal(plan.conflicts.length, 1);
    await seedDirtyCaches(session.id, "tc4");

    // 未确认覆盖 ⇒ 零写入早退 ⇒ 缓存不动
    const skippedReport = await batch.applyBatchIngest(scope, "/导入", plan, {
      overwriteConfirmed: false,
    });
    assert.deepEqual(skippedReport.written, []);
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT),
      ["tc4:canon"],
    );
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_FILE_CACHE),
      ["tc4:full:/a.md"],
    );

    // 确认覆盖 ⇒ 真写入 ⇒ 两域清理
    const applied = await batch.applyBatchIngest(scope, "/导入", plan, {
      overwriteConfirmed: true,
    });
    assert.deepEqual(applied.written, ["/导入/a.md"]);
    assert.equal((await vfs.read("/导入/a.md")).content, "new");
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT),
      [],
    );
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_FILE_CACHE),
      [],
    );
  });

  it("T-C4b: typeConflicts 早退（零写入）两域保持脏 key 原样", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tc4b-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

    const batch = new DefaultVfsBatchIoService(
      ctx.conn,
      new SqliteVfsEntryRepository(ctx.conn),
      { sessionKkv: ctx.sessionKkv },
    );
    // 同一相对路径既是文件又是目录 ⇒ plan 带 typeConflicts（T-B7 同款构造）。
    const plan = await batch.planBatchIngest(scope, "/冲突", [
      { kind: "file", relativePath: "foo", bytes: enc("file") },
      { kind: "directory", relativePath: "foo" },
    ]);
    assert.equal(plan.typeConflicts.length, 1);

    await seedDirtyCaches(session.id, "tc4b");
    const report = await batch.applyBatchIngest(scope, "/冲突", plan, {
      overwriteConfirmed: true,
    });

    // 零写入 ⇒ 两域不动，脏 key 原样（这里 overwriteConfirmed=true 也不改变口径：
    // 门闸看的是 written，不是确认位）。
    assert.deepEqual(report.written, []);
    assert.equal(report.failed.length, 1);
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT),
      ["tc4b:canon"],
    );
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_FILE_CACHE),
      ["tc4b:full:/a.md"],
    );
  });

  it("T-C5: 工厂单参 createVfsBatchIoService(conn) 默认注入 sessionKkv", async () => {
    const ctx = getNovelMasterTestContext();
    const batch = createVfsBatchIoService(ctx.conn);
    // 这里只锁「工厂单参即带 sessionKkv」这一件事：由后续 seed + import 能清空两域
    // 反证（ctx.sessionKkv 的脏 key 能被清掉）。不断言 applyBatchIngest 的存在性
    // ——那是类型层的既有事实，写出来只是恒真噪声。

    const project = await ctx.projects.create(`P-tc5-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await seedDirtyCaches(session.id, "tc5");

    const plan = await batch.planBatchIngest(scope, "/导入", [
      { kind: "file", relativePath: "a.md", bytes: enc("A") },
    ]);
    const report = await batch.applyBatchIngest(scope, "/导入", plan, {
      overwriteConfirmed: false,
    });

    assert.deepEqual(report.written, ["/导入/a.md"]);
    assert.equal((await vfs.read("/导入/a.md")).content, "A");
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT),
      [],
    );
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_FILE_CACHE),
      [],
    );
  });

  it("T-C6: applyBatchIngestWithWriter（新 scope 签名）session + written 非空清理", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tc6-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

    // 预置同名文件 ⇒ plan 带 conflict，才能造出「零写入早退」
    await vfs.write("/导入/a.md", "old");

    const batch = new DefaultVfsBatchIoService(
      ctx.conn,
      new SqliteVfsEntryRepository(ctx.conn),
      { sessionKkv: ctx.sessionKkv },
    );
    const plan = await batch.planBatchIngest(scope, "/导入", [
      { kind: "file", relativePath: "a.md", bytes: enc("A") },
    ]);
    assert.equal(plan.conflicts.length, 1);

    // 零写入（冲突未确认早退）⇒ 不清
    await seedDirtyCaches(session.id, "tc6-early");
    const zeroWritten = await batch.applyBatchIngestWithWriter(
      scope,
      "/导入",
      plan,
      { overwriteConfirmed: false },
      { async mkdir() {}, async writeFile() {} },
    );
    assert.deepEqual(zeroWritten.written, []);
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT),
      ["tc6-early:canon"],
    );

    // 真写入 ⇒ 清（这条链自身不清缓存：user-vfs-turn + vfs write 工具只 upsert
    // 单条 file_cache，不清 rule_snapshot）
    await seedDirtyCaches(session.id, "tc6");
    const report = await batch.applyBatchIngestWithWriter(
      scope,
      "/导入",
      plan,
      { overwriteConfirmed: true },
      {
        async mkdir() {},
        async writeFile(logical, content) {
          await vfs.write(logical, content, { versionCheck: false });
        },
      },
    );

    assert.deepEqual(report.written, ["/导入/a.md"]);
    assert.equal((await vfs.read("/导入/a.md")).content, "A");
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT),
      [],
    );
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_FILE_CACHE),
      [],
    );

    // 第三段：writer **部分失败**（b.md 抛错、a.md 成功，T-B8 同款 writer）⇒ written
    // 非空 ⇒ 两域照清。护的是「writer 链只看 written、不看 failed」这条口径。
    // 两个执行要点（不这么做就恒绿）：
    // ① 必须**重新埋脏**——第二段结尾两域已被清空，不重新 seed 就成「空集断空集」；
    // ② 必须**重新 plan 一份含 a.md+b.md 的 plan**——第二段的 plan 只有 a.md，
    // writer 碰不到 b.md，「b.md 抛错」根本无从发生。
    await seedDirtyCaches(session.id, "tc6-writer-partial");
    const partialPlan = await batch.planBatchIngest(scope, "/导入2", [
      { kind: "file", relativePath: "a.md", bytes: enc("A2") },
      { kind: "file", relativePath: "b.md", bytes: enc("B2") },
    ]);
    assert.equal(partialPlan.writes.length, 2);
    const partial = await batch.applyBatchIngestWithWriter(
      scope,
      "/导入2",
      partialPlan,
      { overwriteConfirmed: false },
      {
        async mkdir() {},
        async writeFile(logical, content) {
          if (logical.endsWith("/b.md")) {
            throw new Error("simulated write fail");
          }
          await vfs.write(logical, content, { versionCheck: false });
        },
      },
    );

    assert.deepEqual(partial.written, ["/导入2/a.md"]);
    assert.equal(partial.failed.length, 1);
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT),
      [],
    );
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_FILE_CACHE),
      [],
    );
  });

  it("T-C7: 跨片失败已有已提交分片 ⇒ 两域清空；同片失败（零写入）⇒ 两域不动", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tc7-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

    // 场景一：**同片**失败（零写入）⇒ 两域保持脏 key 原样。抛错点在第 1 片内，
    // 没有任何已提交分片，门闸 writtenLogical.length > 0 不该放行。
    const sameShardBatch = createVfsBatchIoService(ctx.conn, {
      testHook: { throwOnWriteLogical: "/chap/b.md" },
    });
    await seedDirtyCaches(session.id, "tc7-same-shard");
    const sameShardPlan = await sameShardBatch.planBatchIngest(scope, "/chap", [
      { kind: "file", relativePath: "a.md", bytes: enc("A") },
      { kind: "file", relativePath: "b.md", bytes: enc("B") },
    ]);
    const sameShardReport = await sameShardBatch.applyBatchIngest(
      scope,
      "/chap",
      sameShardPlan,
      { overwriteConfirmed: false }
    );
    assert.deepEqual(sameShardReport.written, [], "同片失败没有任何已提交分片");
    assert.equal(sameShardReport.failed.length, 1);
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT),
      ["tc7-same-shard:canon"],
    );
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_FILE_CACHE),
      ["tc7-same-shard:full:/a.md"],
    );

    // 场景二：**跨片**失败——401 文件切 3 片，第 2 片首个文件抛错 ⇒ 第 1 片 200 个
    // **已真实落库**。下一轮提示词必须按这 200 个新文件重评，所以两域要清
    // （清理排在 failedPath 早退之前，按 writtenLogical.length > 0 判定）。
    // 401 文件 / testHook 构造照 T-B6b。
    const total = 401;
    const failIndex = 200;
    const failLogical = `/chap2/f${String(failIndex).padStart(4, "0")}.md`;
    const crossShardBatch = createVfsBatchIoService(ctx.conn, {
      testHook: { throwOnWriteLogical: failLogical },
    });
    const entries = Array.from({ length: total }, (_, i) => ({
      kind: "file" as const,
      relativePath: `f${String(i).padStart(4, "0")}.md`,
      bytes: enc(`T${i}`),
    }));
    const crossShardPlan = await crossShardBatch.planBatchIngest(
      scope,
      "/chap2",
      entries
    );
    assert.equal(crossShardPlan.writes.length, total);

    await seedDirtyCaches(session.id, "tc7-cross-shard");
    const crossShardReport = await crossShardBatch.applyBatchIngest(
      scope,
      "/chap2",
      crossShardPlan,
      { overwriteConfirmed: false }
    );

    assert.equal(crossShardReport.written.length, 200, "第 1 片 200 个已提交");
    assert.equal(crossShardReport.failed.length, 1);
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT),
      [],
      "跨片失败有已提交分片 ⇒ rule_snapshot 必须清",
    );
    assert.deepEqual(
      await ctx.sessionKkv.listKeys(session.id, SESSION_KKV_DOMAIN_FILE_CACHE),
      [],
      "跨片失败有已提交分片 ⇒ file_cache 必须清",
    );
  });
});

/**
 * CS-05 分片提交在 `applyBatchIngest` 上的事务计数口径。
 *
 * 自带一条被探针装饰的连接（共享 fixture 的连接不做事务观测，避免与其它
 * 用例的连接状态互相污染）。
 */
describe("VfsBatchIoService 分片事务计数", () => {
  let conn: TdbcConnection;
  let probe: TransactionProbe;
  let ctx: Awaited<ReturnType<typeof openNovelMasterTestConnection>>;

  before(async () => {
    ctx = await openNovelMasterTestConnection();
    const probed = probeTransactions(ctx.conn);
    conn = probed.conn;
    probe = probed.probe;
  });

  after(async () => {
    await ctx.conn.close();
  });

  it("T-B6c: 401 个文件（无显式目录）⇒ 恰好 3 条文件分片事务，段 B0 不跑", async () => {
    const project = await ctx.projects.create(`P-batchio-${testIsolationSuffix()}`);
    const scope = { kind: "project" as const, projectId: project.id };
    const total = 401;
    const entries = Array.from({ length: total }, (_, i) => ({
      kind: "file" as const,
      relativePath: `f${String(i).padStart(4, "0")}.md`,
      bytes: enc(`C${i}`),
    }));

    const batch = createVfsBatchIoService(conn);
    const plan = await batch.planBatchIngest(scope, "/chap", entries);
    probe.reset();
    const report = await batch.applyBatchIngest(scope, "/chap", plan, {
      overwriteConfirmed: false,
    });

    assert.equal(report.failed.length, 0);
    assert.equal(report.written.length, total);
    // 401 个文件没有显式目录 ⇒ 不跑段 B0，只有 3 条文件分片事务。
    assert.equal(plan.mkdirPaths.length, 0);
    assert.equal(probe.transactionCount, 3, "旧形态（整批一条事务）这里是 1");
    // 每片文件数上界：单条事务内的 entry 插入只可能来自本片文件 + 它们的父目录行
    // （`ensureParentDirectories` 造的 `/chap` 目录行落在第 1 片里）。
    let totalInserts = 0;
    for (let i = 0; i < probe.transactionCount; i++) {
      const inserts = probe
        .statementsInTransaction(i)
        .filter((s) => /INSERT INTO vfs_entry/i.test(s.sql)).length;
      totalInserts += inserts;
      assert.ok(inserts <= 202, `第 ${i + 1} 片插了 ${inserts} 个 entry`);
    }
    assert.equal(totalInserts, total + 1, "401 个文件 + 1 个父目录行");
  });

  it("T-B6d: plan.writes 为空（纯 mkdir）⇒ 只跑段 B0 一条事务；全空 plan ⇒ 零事务", async () => {
    const project = await ctx.projects.create(`P-batchio-${testIsolationSuffix()}`);
    const scope = { kind: "project" as const, projectId: project.id };
    const batch = createVfsBatchIoService(conn);

    const mkdirOnly = await batch.planBatchIngest(scope, "/", [
      { kind: "directory", relativePath: "empty-dir" },
    ]);
    probe.reset();
    await batch.applyBatchIngest(scope, "/", mkdirOnly, {
      overwriteConfirmed: false,
    });
    assert.equal(probe.transactionCount, 1, "纯 mkdir 只跑段 B0");

    const nothing = await batch.planBatchIngest(scope, "/", []);
    probe.reset();
    const report = await batch.applyBatchIngest(scope, "/", nothing, {
      overwriteConfirmed: false,
    });
    assert.equal(probe.transactionCount, 0, "空 plan 不开任何事务");
    assert.deepEqual(report.written, []);
    assert.equal(
      (
        await createScopedVfsService(conn, scope).list("/", {
          recursive: false,
        })
      ).length,
      1,
      "目录行确实建出来了"
    );
  });
});
