/**
 * L1 缓存签名三元组之 smart_sort_rule 指纹（core/B-3）行为套件。
 *
 * 规格：docs/Iterations/smart-filename-sort/cr-fix-spec.md core/B-3。
 * 背景：dev 引入的 L1 读时校验签名原为 {vfs, rules} 二元组，智能规则表不在
 * 签名内——目录规则选 smart 后改智能规则（增删改/启停/调序）缓存不失效，
 * 返回旧排序。本套件验证签名扩为三元组后：改智能规则 → 签名 miss 重算、
 * 排序刷新；未动智能规则 → 缓存照旧命中。
 *
 * 计数方式：沿用 workplace-view-cache.test.ts 的 spying 范式——包装
 * VfsEntryRepository 对 listFileMetaUnderPrefix 计数（命中缓存不触它）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteWorkplaceRepository } from "@/domain/workplace/repositories/impl/sqlite-workplace.repository.js";
import { SqliteSmartSortRuleRepository } from "@/domain/smart-sort-rule/repositories/impl/sqlite-smart-sort-rule.repository.js";
import { compileSmartSortRule } from "@/domain/smart-sort-rule/logic/compile-smart-sort-rule.js";
import { DefaultWorkplaceService } from "@/service/workplace/impl/workplace.service.js";
import { clearAllWorkplaceViewCache } from "@/service/workplace/impl/workplace-view-cache.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

/**
 * spying 构造：provider 组装照生产工厂（createWorkplaceService）同款——
 * smartRules 懒加载编译 + smartRuleRows 原始行（签名采样）。
 */
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
    findContentSizeByPath: (...args) => baseRepo.findContentSizeByPath(...args),
    insert: (...args) => baseRepo.insert(...args),
    insertWithContentHash: (...args) => baseRepo.insertWithContentHash(...args),
    insertAtVersion: (...args) => baseRepo.insertAtVersion(...args),
    insertDirectory: (...args) => baseRepo.insertDirectory(...args),
    update: (...args) => baseRepo.update(...args),
    updateWithContentHash: (...args) =>
      baseRepo.updateWithContentHash(...args),
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

  const smartRepo = new SqliteSmartSortRuleRepository(conn);
  const wt = new DefaultWorkplaceService({
    conn,
    scope: { kind: "project", projectId },
    vfs,
    workplace: new SqliteWorkplaceRepository(conn),
    smartRules: async () => {
      const compiled = [];
      for (const rule of await smartRepo.listOrdered()) {
        if (rule.enabled) {
          compiled.push(compileSmartSortRule(rule));
        }
      }
      return compiled;
    },
    smartRuleRows: () => smartRepo.listOrdered(),
  });

  return { wt, calls };
}

/** 取列表中某目录下的 file 行路径序列（保持行序）。 */
function filePathsUnder(
  rows: ReadonlyArray<{ kind: string; path: string }>,
  dir: string
): string[] {
  return rows
    .filter((r) => r.kind === "file" && r.path.startsWith(`${dir}/`))
    .map((r) => r.path);
}

novelMasterTestFixture();

describe("L1 缓存签名三元组：smart_sort_rule 指纹（core/B-3）", () => {
  it("T-B3a：smart 排序目录改智能规则——签名 miss 重算且排序刷新", async () => {
    clearAllWorkplaceViewCache();
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/r/第5章.md", "五");
    await pvfs.write("/r/序章.md", "序");

    const { wt, calls } = createSpyingWorkplaceService(ctx.conn, project.id);
    await wt.setDirRule({
      logicalPath: "/r",
      ruleEnabled: true,
      sortField: "smart",
      sortOrder: "asc",
      headCount: 10,
      tailCount: 0,
      fillPolicy: "hidden",
    });

    // 首评（D13 后）：builtin-zh-prologue（fixed_min）命中「序章」提取哨兵
    // 元组 (-Infinity)，builtin-zh-chapter 命中「第5章」提取序号 5；
    // 元组比较 -Infinity < 5 → 序章恒在前
    const first = filePathsUnder(await wt.buildListRows(), "/r");
    assert.deepEqual(
      first,
      ["/r/序章.md", "/r/第5章.md"],
      "smart 排序：序章（fixed_min 哨兵）排在第5章（序号 5）前"
    );
    assert.equal(calls.listFileMetaUnderPrefix, 1, "首次评估全量加载一次");

    // 改智能规则：禁用 builtin-zh-prologue（整行 update，行数不变）
    const smartRepo = new SqliteSmartSortRuleRepository(ctx.conn);
    const prologue = (await smartRepo.listOrdered()).find(
      (r) => r.ruleId === "builtin-zh-prologue"
    );
    assert.ok(prologue != null, "seed 应含 builtin-zh-prologue");
    assert.equal(prologue.enabled, true, "内置规则 seed 默认启用");
    await smartRepo.update({ ...prologue, enabled: false });

    // 再评：签名 miss 重算——「序章」失去哨兵元组退化为无序号，而「第5章」
    // 仍命中 zh-chapter 提取 [5]；比较全序第 1 条（有序号者在前）序反转
    const second = filePathsUnder(await wt.buildListRows(), "/r");
    assert.equal(
      calls.listFileMetaUnderPrefix,
      2,
      "改智能规则后签名失效，缓存 miss 重算"
    );
    assert.deepEqual(
      second,
      ["/r/第5章.md", "/r/序章.md"],
      "禁用后：有序号的第5章排在无序号的序章前（全序第 1 条）"
    );
    assert.notDeepEqual(second, first, "排序结果与旧缓存不一致");
  });

  it("T-B3b：未动智能规则时缓存照旧命中（含非 smart 库）", async () => {
    clearAllWorkplaceViewCache();
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/a.md", "A");
    await pvfs.write("/b.md", "B");

    const { wt, calls } = createSpyingWorkplaceService(ctx.conn, project.id);
    const first = await wt.buildListRows();
    assert.equal(calls.listFileMetaUnderPrefix, 1);

    // 无写、无规则改动：智能规则表指纹恒定，第二次评估命中缓存
    const second = await wt.buildListRows();
    assert.equal(
      calls.listFileMetaUnderPrefix,
      1,
      "智能规则未变，签名恒定，缓存照旧命中"
    );
    assert.deepEqual(second, first, "两次结果 deep-equal");
  });
});
