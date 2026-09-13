/**
 * workplace 评估链 L1 memo（conn 级读时校验缓存）行为与失效套件。
 *
 * 规格：docs/Iterations/workplace-eval-memo/spec.md（T-WMC1~T-WMC9）。
 * 计数方式说明：沿用 workplace-live-view.test.ts 的 spying 范式——包装
 * VfsEntryRepository 委托 baseRepo 并对 `listFileMetaUnderPrefix` 计数，
 * 该计数即「全量评估次数」（命中缓存与采样签名都不触它；采样走
 * computeEntrySignature 的单行聚合 SQL）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorkplaceService } from "@novel-master/core/workplace";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteWorkplaceRepository } from "@/domain/workplace/repositories/impl/sqlite-workplace.repository.js";
import { DefaultWorkplaceService } from "@/service/workplace/impl/workplace.service.js";
import { clearAllWorkplaceViewCache } from "@/service/workplace/impl/workplace-view-cache.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

function createSpyingWorkplaceService(
  conn: import("@novel-master/core").TdbcConnection,
  projectId: string
) {
  const baseRepo = new SqliteVfsEntryRepository(conn);
  const calls = {
    listFileMetaUnderPrefix: 0,
  };

  const vfs: VfsEntryRepository = {
    list: (...args) => baseRepo.list(...args),
    findByPath: (...args) => baseRepo.findByPath(...args),
    findContentHash: (...args) => baseRepo.findContentHash(...args),
    findContentHashesByPaths: (...args) =>
      baseRepo.findContentHashesByPaths(...args),
    findContentSizeByPath: (...args) =>
      baseRepo.findContentSizeByPath(...args),
    insert: (...args) => baseRepo.insert(...args),
    insertWithContentHash: (...args) => baseRepo.insertWithContentHash(...args),
    insertAtVersion: (...args) => baseRepo.insertAtVersion(...args),
    insertDirectory: (...args) => baseRepo.insertDirectory(...args),
    update: (...args) => baseRepo.update(...args),
    updateWithContentHash: (...args) => baseRepo.updateWithContentHash(...args),
    setHeadContentHash: (...args) => baseRepo.setHeadContentHash(...args),
    delete: (...args) => baseRepo.delete(...args),
    deleteRecursiveIfAny: (...args) => baseRepo.deleteRecursiveIfAny(...args),
    listAllPaths: (...args) => baseRepo.listAllPaths(...args),
    listDirectoryPathsUnderPrefix: (...args) =>
      baseRepo.listDirectoryPathsUnderPrefix(...args),
    listEntriesUnderPrefix: (...args) =>
      baseRepo.listEntriesUnderPrefix(...args),
    listFileMetaUnderPrefix: async (...args) => {
      calls.listFileMetaUnderPrefix += 1;
      return baseRepo.listFileMetaUnderPrefix(...args);
    },
    listDirectoryMetaUnderPrefix: (...args) =>
      baseRepo.listDirectoryMetaUnderPrefix(...args),
    listFileHeadsUnderPrefix: (...args) =>
      baseRepo.listFileHeadsUnderPrefix(...args),
    scanContents: (...args) => baseRepo.scanContents(...args),
    renamePathInScope: (...args) => baseRepo.renamePathInScope(...args),
    renamePrefixInScope: (...args) => baseRepo.renamePrefixInScope(...args),
    scanFileEntriesWithMeta: (...args) =>
      baseRepo.scanFileEntriesWithMeta(...args),
    findExistingPaths: (...args) => baseRepo.findExistingPaths(...args),
    batchInsertFileEntriesWithHash: (...args) =>
      baseRepo.batchInsertFileEntriesWithHash(...args),
    batchInsertDirectoryEntries: (...args) =>
      baseRepo.batchInsertDirectoryEntries(...args),
    computeEntrySignature: (...args) => baseRepo.computeEntrySignature(...args),
  };

  const wt = new DefaultWorkplaceService({
    conn,
    scope: { kind: "project", projectId },
    vfs,
    workplace: new SqliteWorkplaceRepository(conn),
  });

  return { wt, calls };
}

/** 保证 mtime 分层（better-sqlite3 的 mtime_ms 为 Date.now() 毫秒级）。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

novelMasterTestFixture();

describe("workplace 评估链 L1 memo（conn 级读时校验缓存）", () => {
  it("T-WMC1：同 scope 连续两次 buildListRows——仅一次全量 metadata 且结果一致", async () => {
    clearAllWorkplaceViewCache();
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/a.md", "A");
    await pvfs.write("/b.md", "B");

    const { wt, calls } = createSpyingWorkplaceService(ctx.conn, project.id);
    const first = await wt.buildListRows();
    assert.equal(calls.listFileMetaUnderPrefix, 1, "首次评估全量加载一次");

    const second = await wt.buildListRows();
    assert.equal(
      calls.listFileMetaUnderPrefix,
      1,
      "第二次评估应命中缓存，不再全量查询"
    );
    assert.deepEqual(second, first, "两次结果 deep-equal");
  });

  it("T-WMC2：写同一文件后签名失效——重评估计数增长且新内容可见", async () => {
    clearAllWorkplaceViewCache();
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/a.md", "A");

    const { wt, calls } = createSpyingWorkplaceService(ctx.conn, project.id);
    const first = await wt.buildListRows();
    assert.ok(!first.some((r) => r.path === "/new.md"));
    assert.equal(calls.listFileMetaUnderPrefix, 1);

    await pvfs.write("/new.md", "N");
    const second = await wt.buildListRows();
    assert.equal(
      calls.listFileMetaUnderPrefix,
      2,
      "写后签名变化，缓存失效重算"
    );
    assert.ok(
      second.some((r) => r.path === "/new.md"),
      "新文件在视图中可见"
    );
  });

  it("T-WMC3：rename 只改 path（count/version 集合语义不变）——path 敏感签名失效，视图路径更新", async () => {
    clearAllWorkplaceViewCache();
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/dir/x.md", "X");

    const { wt, calls } = createSpyingWorkplaceService(ctx.conn, project.id);
    const first = await wt.buildListRows();
    assert.ok(first.some((r) => r.path === "/dir/x.md"));
    assert.equal(calls.listFileMetaUnderPrefix, 1);

    await pvfs.renamePath("/dir/x.md", "/dir/y.md");
    const second = await wt.buildListRows();
    assert.equal(calls.listFileMetaUnderPrefix, 2, "rename 后缓存失效");
    assert.ok(
      !second.some((r) => r.path === "/dir/x.md"),
      "旧路径从视图消失"
    );
    assert.ok(
      second.some((r) => r.path === "/dir/y.md"),
      "新路径出现在视图"
    );
  });

  it("T-WMC4：规则同数改写（翻转 rule_enabled，行数不变）——规则序列化签名失效", async () => {
    clearAllWorkplaceViewCache();
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/r/a.md", "A");
    await pvfs.write("/r/b.md", "B");

    const { wt, calls } = createSpyingWorkplaceService(ctx.conn, project.id);
    // 先关闭规则（引擎语义：rule_off 目录下 auto 文件全部 hidden）
    await wt.setDirRule({
      logicalPath: "/r",
      ruleEnabled: false,
      sortField: "name",
      sortOrder: "asc",
      headCount: 1,
      tailCount: 0,
      fillPolicy: "hidden",
    });
    const first = await wt.buildListRows();
    const firstA = first.find((r) => r.path === "/r/a.md") as {
      displayState: string;
    };
    assert.equal(firstA.displayState, "hidden", "规则关闭下 a.md 隐藏");
    assert.equal(calls.listFileMetaUnderPrefix, 1);

    // 规则表行数不变，仅翻转 rule_enabled —— 聚合指纹抓不住，序列化签名必须抓住
    await wt.setDirRule({ logicalPath: "/r", ruleEnabled: true });
    const second = await wt.buildListRows();
    assert.equal(
      calls.listFileMetaUnderPrefix,
      2,
      "同数改写后规则签名变化，缓存失效"
    );
    const secondA = second.find((r) => r.path === "/r/a.md") as {
      displayState: string;
    };
    assert.equal(
      secondA.displayState,
      "full",
      "规则启用后 headCount=1 下 a.md 全量展示"
    );
  });

  it("T-WMC5：resetHeadToVersion 写回历史 mtime——按 updated 排序的视图变化可见", async () => {
    clearAllWorkplaceViewCache();
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/d/f1.md", "1");
    await sleep(3);
    await pvfs.write("/d/f2.md", "2");
    await sleep(3);
    await pvfs.write("/d/f1.md", "1b"); // f1 v2，mtime 最新

    const { wt, calls } = createSpyingWorkplaceService(ctx.conn, project.id);
    await wt.setDirRule({
      logicalPath: "/d",
      ruleEnabled: true,
      sortField: "updated",
      sortOrder: "desc",
      headCount: 1,
      tailCount: 0,
      fillPolicy: "hidden",
    });
    const first = await wt.buildListRows();
    assert.equal(calls.listFileMetaUnderPrefix, 1);
    const state1 = (p: string) =>
      (first.find((r) => r.path === p) as { displayState: string }).displayState;
    assert.equal(state1("/d/f1.md"), "full", "f1 mtime 最新，head 展示");
    assert.equal(state1("/d/f2.md"), "hidden");

    // 回滚 f1 到 v1：写回历史 (version=1, mtime=最早) —— max 持有者不是被回拨行
    await pvfs.resetHeadToVersion("/d/f1.md", 1);
    const second = await wt.buildListRows();
    assert.equal(calls.listFileMetaUnderPrefix, 2, "回滚后签名变化，缓存失效");
    const state2 = (p: string) =>
      (second.find((r) => r.path === p) as { displayState: string })
        .displayState;
    assert.equal(
      state2("/d/f2.md"),
      "full",
      "回滚后 f2 mtime 最新，接管 head 展示"
    );
    assert.equal(state2("/d/f1.md"), "hidden");
  });

  it("T-WMC6：同 conn 两个 service 实例同 scope——第二实例命中（工厂击穿场景）", async () => {
    clearAllWorkplaceViewCache();
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/cross/i1.md", "I1");
    await pvfs.write("/cross/i2.md", "I2");

    // 实例 A：手工 spying 构造（计数用）
    const a = createSpyingWorkplaceService(ctx.conn, project.id);
    const rowsA = await a.wt.buildListRows();
    assert.equal(a.calls.listFileMetaUnderPrefix, 1);

    // 实例 B：走生产工厂（runtime.workplace 每次调用 new 新实例的路径）
    const b = createWorkplaceService(ctx.conn, {
      kind: "project",
      projectId: project.id,
    });
    const rowsB = await b.buildListRows();
    assert.equal(
      a.calls.listFileMetaUnderPrefix,
      1,
      "同 conn 跨实例共享缓存，第二实例命中不再全量查询"
    );
    assert.deepEqual(rowsB, rowsA);
  });

  it("T-WMC7：两个连接同名 scope（global）互不命中——无跨库串缓存", async () => {
    clearAllWorkplaceViewCache();
    const ctx = getNovelMasterTestContext();
    await ctx.globalVfs().write("/shared-marker.md", "M");

    const a = createWorkplaceService(ctx.conn, { kind: "global" });
    const rowsA = await a.buildListRows();
    assert.ok(
      rowsA.some((r) => r.path === "/shared-marker.md"),
      "conn A 的 global 视图含标记文件"
    );

    // conn B：独立内存库（core 测试多库同进程场景）
    const secondCtx = await openNovelMasterTestConnection();
    try {
      const b = createWorkplaceService(secondCtx.conn, { kind: "global" });
      const rowsB = await b.buildListRows();
      assert.ok(
        !rowsB.some((r) => r.path === "/shared-marker.md"),
        "conn B 不得命中 conn A 的缓存（WeakMap 按 conn 隔离）"
      );
      // B 库写自己的标记后 B 评估的是 B 库数据，A 的缓存不受影响
      await secondCtx.globalVfs().write("/b-only.md", "B");
      const rowsB2 = await b.buildListRows();
      assert.ok(rowsB2.some((r) => r.path === "/b-only.md"));
      assert.ok(!rowsB2.some((r) => r.path === "/shared-marker.md"));
    } finally {
      await secondCtx.conn.close();
    }
  });

  it("T-WMC8：mkdir 空目录改变签名——空目录在视图中可见", async () => {
    clearAllWorkplaceViewCache();
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);

    const { wt, calls } = createSpyingWorkplaceService(ctx.conn, project.id);
    await pvfs.mkdir("/empty");
    const first = await wt.buildListRows();
    assert.equal(calls.listFileMetaUnderPrefix, 1);

    // 空目录无文件行：若签名按 entry_kind 过滤，第二次评估将命中旧缓存、
    // 新空目录不可见——这里要求不过滤，mkdir 空目录也必须改变签名
    await pvfs.mkdir("/empty2");
    const second = await wt.buildListRows();
    assert.equal(calls.listFileMetaUnderPrefix, 2, "mkdir 空目录后缓存失效");
    assert.ok(
      second.some((r) => r.kind === "dir" && r.path === "/empty2"),
      "新空目录出现在视图中"
    );
    assert.ok(
      first.some((r) => r.kind === "dir" && r.path === "/empty"),
      "首个空目录同样可见"
    );
  });

  it("T-WMC9：600 文件毒库性能哨兵——第二次评估零全量查询且耗时显著低于首次", async () => {
    clearAllWorkplaceViewCache();
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    const TOTAL = 600;
    for (let i = 0; i < TOTAL; i++) {
      await pvfs.write(`/世界书/条目${String(i).padStart(4, "0")}·📖.md`, `内容 ${i}`);
    }

    const { wt, calls } = createSpyingWorkplaceService(ctx.conn, project.id);
    await wt.setDirRule({
      logicalPath: "/世界书",
      ruleEnabled: true,
      sortField: "name",
      sortOrder: "asc",
      headCount: 10,
      tailCount: 0,
      fillPolicy: "hidden",
    });

    const t0 = Date.now();
    const first = await wt.buildListRows();
    const coldElapsed = Date.now() - t0;
    assert.equal(calls.listFileMetaUnderPrefix, 1);
    assert.equal(
      first.filter((r) => r.kind === "file").length,
      TOTAL,
      "600 文件行完整（另有根/目录行不计入）"
    );

    const t1 = Date.now();
    const second = await wt.buildListRows();
    const warmElapsed = Date.now() - t1;
    assert.equal(
      calls.listFileMetaUnderPrefix,
      1,
      "第二次评估不得增长全量查询计数"
    );
    assert.deepEqual(second, first);
    // 性能哨兵：命中路径只剩 1 条聚合签名 SQL + 规则全量重读，应显著低于
    // 冷启动的全量计算；绝对上限防 CI 抖动下的 flaky（非精确断言）
    assert.ok(
      warmElapsed < coldElapsed,
      `warm(${warmElapsed}ms) 应低于 cold(${coldElapsed}ms)`
    );
    assert.ok(warmElapsed < 500, `warm 应远低于 500ms，实际 ${warmElapsed}ms`);
  });
});
