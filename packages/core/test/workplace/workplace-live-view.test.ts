import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteWorkplaceRepository } from "@/domain/workplace/repositories/impl/sqlite-workplace.repository.js";
import { DefaultWorkplaceService } from "@/service/workplace/impl/workplace.service.js";
import { DEFAULT_WORKPLACE_DIR_RULE } from "@/domain/workplace/logic/default-dir-rule.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

function createSpyingWorkplaceService(
  conn: import("@novel-master/core").TdbcConnection,
  projectId: string,
) {
  const baseRepo = new SqliteVfsEntryRepository(conn);
  const calls = {
    listFileMetaUnderPrefix: 0,
  };

  const vfs: VfsEntryRepository = {
    list: (...args) => baseRepo.list(...args),
    findByPath: (...args) => baseRepo.findByPath(...args),
    findContentHash: (...args) => baseRepo.findContentHash(...args),
    insert: (...args) => baseRepo.insert(...args),
    insertWithContentHash: (...args) => baseRepo.insertWithContentHash(...args),
    insertAtVersion: (...args) => baseRepo.insertAtVersion(...args),
    insertDirectory: (...args) => baseRepo.insertDirectory(...args),
    update: (...args) => baseRepo.update(...args),
    updateWithContentHash: (...args) => baseRepo.updateWithContentHash(...args),
    setHeadContentHash: (...args) => baseRepo.setHeadContentHash(...args),
    delete: (...args) => baseRepo.delete(...args),
    listAllPaths: (...args) => baseRepo.listAllPaths(...args),
    listDirectoryPathsUnderPrefix: (...args) =>
      baseRepo.listDirectoryPathsUnderPrefix(...args),
    listEntriesUnderPrefix: (...args) =>
      baseRepo.listEntriesUnderPrefix(...args),
    listFileMetaUnderPrefix: async (...args) => {
      calls.listFileMetaUnderPrefix += 1;
      return baseRepo.listFileMetaUnderPrefix(...args);
    },
    listFileHeadsUnderPrefix: (...args) =>
      baseRepo.listFileHeadsUnderPrefix(...args),
    scanContents: (...args) => baseRepo.scanContents(...args),
  };

  const wt = new DefaultWorkplaceService({
    scope: { kind: "project", projectId },
    vfs,
    workplace: new SqliteWorkplaceRepository(conn),
  });

  return { wt, calls };
}

novelMasterTestFixture();

describe("worktree materializeLiveView", () => {
  it("T-WEC13：materializeLiveView 仅加载一次 metadata", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/a.md", "A");
    await pvfs.write("/b.md", "B");

    const { wt, calls } = createSpyingWorkplaceService(ctx.conn, project.id);
    calls.listFileMetaUnderPrefix = 0;

    const live = await wt.materializeLiveView();
    assert.ok(live.listRows.length >= 3);
    assert.ok(live.filetreeDisplay.length > 0);
    assert.equal(calls.listFileMetaUnderPrefix, 1);
  });

  it("T-WEC13：并发 buildListRows + renderFileTree 合并为单次 metadata", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/x.md", "X");

    const { wt, calls } = createSpyingWorkplaceService(ctx.conn, project.id);
    calls.listFileMetaUnderPrefix = 0;

    const [rows, fileTree] = await Promise.all([
      wt.buildListRows(),
      wt.renderFileTree(),
    ]);
    assert.ok(rows.length >= 2);
    assert.ok(fileTree.length > 0);
    assert.equal(
      calls.listFileMetaUnderPrefix,
      1,
      "并发调用应合并为单次 metadata 加载",
    );
  });

  it("T-WEC13：委托方法与 materializeLiveView 字段一致", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/parity/a.md", "A");
    await pvfs.write("/parity/b.md", "B");

    const { wt } = createSpyingWorkplaceService(ctx.conn, project.id);
    await wt.setFileRule({
      logicalPath: "/parity/a.md",
      inclusionMode: "show",
    });

    const live = await wt.materializeLiveView();
    const rows = await wt.buildListRows();
    const fileTree = await wt.renderFileTree();

    assert.deepEqual(
      rows.map((r) => r.path),
      live.listRows.map((r) => r.path),
    );
    assert.equal(fileTree, live.filetreeDisplay);

    const fileRow = live.listRows.find(
      (r) => r.kind === "file" && r.path === "/parity/a.md",
    );
    assert.ok(fileRow);
    assert.equal(fileRow.inclusionMode, "show");
    assert.equal(fileRow.displayState, "full");
  });

  it("deleteRulesUnderLogicalPrefix 移除幽灵目录行", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/55/诗歌.txt", "poem", { versionCheck: false });
    await svfs.delete("/55", { recursive: true });

    const wt = new DefaultWorkplaceService({
      scope: { kind: "session", projectId: project.id, sessionId: session.id },
      vfs: new SqliteVfsEntryRepository(ctx.conn),
      workplace: new SqliteWorkplaceRepository(ctx.conn),
    });
    await wt.setFileRule({
      logicalPath: "/55/诗歌.txt",
      inclusionMode: "show",
    });

    let rows = await wt.buildListRows();
    assert.ok(rows.some((r) => r.kind === "dir" && r.path === "/55"));

    await wt.deleteRulesUnderLogicalPrefix("/55");

    rows = await wt.buildListRows();
    assert.ok(!rows.some((r) => r.path === "/55" || r.path.startsWith("/55/")));
  });

  it("renameRulesUnderLogicalPrefix 批量重命名目录及子路径规则", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    // 准备文件结构
    await svfs.write("/原/子/a.md", "a", { versionCheck: false });
    await svfs.write("/原/子/b.md", "b", { versionCheck: false });
    await svfs.write("/原/c.md", "c", { versionCheck: false });
    await svfs.write("/其他/d.md", "d", { versionCheck: false });

    const wt = new DefaultWorkplaceService({
      scope: { kind: "session", projectId: project.id, sessionId: session.id },
      vfs: new SqliteVfsEntryRepository(ctx.conn),
      workplace: new SqliteWorkplaceRepository(ctx.conn),
    });
    // 设规则
    await wt.setDirRule({
      ...DEFAULT_WORKPLACE_DIR_RULE,
      logicalPath: "/原",
      ruleEnabled: true,
    });
    await wt.setDirRule({
      ...DEFAULT_WORKPLACE_DIR_RULE,
      logicalPath: "/原/子",
      ruleEnabled: true,
    });
    await wt.setFileRule({
      logicalPath: "/原/c.md",
      inclusionMode: "hide",
    });
    await wt.setFileRule({
      logicalPath: "/其他/d.md",
      inclusionMode: "show",
    });

    // rename /原 → /新名
    await wt.renameRulesUnderLogicalPrefix("/原", "/新名");

    // 旧路径规则应不存在
    assert.equal(await wt.getDirRule("/原"), undefined);
    assert.equal(await wt.getDirRule("/原/子"), undefined);

    // 新路径规则应存在且保留原配置
    const newRootRule = await wt.getDirRule("/新名");
    assert.ok(newRootRule != null);
    assert.equal(newRootRule.ruleEnabled, true);

    const newSubRule = await wt.getDirRule("/新名/子");
    assert.ok(newSubRule != null);
    assert.equal(newSubRule.ruleEnabled, true);

    // 子文件规则也应迁移（直接查 repo，因为 buildListRows 的 path 来自 VFS entry，
    // 不是 file_rule 表）
    const fileScopeKey = `session:${session.id}`;
    const repo = new SqliteWorkplaceRepository(ctx.conn);
    const migratedFileRule = await repo.findFileRule(
      fileScopeKey,
      "/新名/c.md",
    );
    assert.ok(migratedFileRule != null, "/新名/c.md 的 file rule 应已迁移");
    assert.equal(migratedFileRule.inclusionMode, "hide");

    // 旧路径不应再有规则
    const oldFileRule = await repo.findFileRule(
      fileScopeKey,
      "/原/c.md",
    );
    assert.equal(oldFileRule, null);

    // 不相关路径不受影响
    const otherRule = await repo.findFileRule(
      fileScopeKey,
      "/其他/d.md",
    );
    assert.ok(otherRule != null);
    assert.equal(otherRule.inclusionMode, "show");
  });

  it("renameRulesUnderLogicalPrefix 任一侧失败时整批回滚", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/原/c.md", "c", { versionCheck: false });

    // 只抛 file_rule 表的 UPDATE，dir_rule 的 UPDATE 会先执行成功。
    // 用包装 transaction：驱动层负责 BEGIN/ROLLBACK，但 tx 的 execute 遇到
    // file_rule 语句时抛错，验证事务把已成功的 dir_rule UPDATE 一并回滚。
    const real = ctx.conn;
    const failingConn: import("@novel-master/core").TdbcConnection = {
      execute: (sql, params) => real.execute(sql, params),
      query: (sql, params) => real.query(sql, params),
      batch: (sql, list) => real.batch(sql, list),
      transaction(fn) {
        return real.transaction(async (tx) =>
          fn({
            execute: async (sql, params) => {
              if (String(sql).includes("workplace_file_rule")) {
                throw new Error("simulated file_rule update failure");
              }
              return tx.execute(sql, params);
            },
            query: (sql, params) => tx.query(sql, params),
            batch: (sql, list) => tx.batch(sql, list),
            transaction: (inner) => tx.transaction(inner),
            close: () => tx.close(),
          }),
        );
      },
      close: () => real.close(),
    };

    const wt = new DefaultWorkplaceService({
      scope: { kind: "session", projectId: project.id, sessionId: session.id },
      vfs: new SqliteVfsEntryRepository(ctx.conn),
      workplace: new SqliteWorkplaceRepository(failingConn),
    });
    await wt.setDirRule({
      ...DEFAULT_WORKPLACE_DIR_RULE,
      logicalPath: "/原",
      ruleEnabled: true,
    });
    await wt.setDirRule({
      ...DEFAULT_WORKPLACE_DIR_RULE,
      logicalPath: "/原/子",
      ruleEnabled: true,
    });

    // file_rule 侧失败应让整个 rename 抛错，且 dir_rule 的 UPDATE 一并回滚
    await assert.rejects(
      wt.renameRulesUnderLogicalPrefix("/原", "/新名"),
      /simulated file_rule update failure/,
    );

    const repo = new SqliteWorkplaceRepository(ctx.conn);
    const fileScopeKey = `session:${session.id}`;
    // 旧 dir 规则仍在（未半套提交），新规则未生成
    assert.ok((await repo.findDirRule(fileScopeKey, "/原")) != null);
    assert.ok((await repo.findDirRule(fileScopeKey, "/原/子")) != null);
    assert.equal(await repo.findDirRule(fileScopeKey, "/新名"), null);
  });
});
