/**
 * 推送链 core 层测试（workspace-push spec Step 2）：
 * - T-WP1 整树覆盖：project 有 A/B、session 有 B'/C → push 后 project 为 B'/C（A 被删）
 * - T-WP2 目录规则覆盖：push 后 project 规则 = session 版本（copyScope 覆盖语义）
 * - T-WP3 blob 无孤儿（pushSessionTemplate 载体，镜像 vfs-gc-trigger T-G2 模式）
 * - T-WP4 会话不存在抛 CHAT_NOT_FOUND；事务失败回滚不留半态
 *
 * T-WP5（既有 pull/template 测试不回归）由同目录既有测试文件守护，本文件不重复。
 *
 * @module test/service/template/push-session-workspace
 */

import { unwrap } from "../../helpers/result-unwrap.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorkplaceService } from "@novel-master/core/workplace";
import { createTemplatePullService } from "../../../src/service/template/create-template-pull-service.js";
import { SqliteWorkplaceRepository } from "@/domain/workplace/repositories/impl/sqlite-workplace.repository.js";
import { isAppError } from "@/errors/app-error.js";
import { pushSessionWorkspace } from "@/service/template/logic/push-session-workspace.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("push-session-workspace（session → project 整树推送）", () => {
  it("T-WP1: 整树覆盖——project 孤儿文件被删、内容取 session 版本", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = unwrap(await ctx.projects.create(`P-${suffix}`));
    const pvfs = ctx.projectVfs(project.id);
    unwrap(await pvfs.write("/a.md", `A-${suffix}`));
    unwrap(await pvfs.write("/b.md", `B-old-${suffix}`));

    const session = unwrap(await ctx.sessions.create(project.id));
    const svfs = ctx.sessionVfs(project.id, session.id);
    // session 侧：改写 b + 新增 c（a 已删——先在 session 删掉 a）
    unwrap(await svfs.delete("/a.md"));
    unwrap(await svfs.write("/b.md", `B-new-${suffix}`));
    unwrap(await svfs.write("/sub/c.md", `C-${suffix}`));

    await createTemplatePullService(ctx.conn).pushSessionTemplate(session.id);

    // project 树 == session 快照：b'/c 在，a 被删
    const paths = unwrap(await pvfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path)
      .sort();
    assert.deepEqual(paths, ["/b.md", "/sub/c.md"], "project 应为 session 版 B'/C（A 删除）");
    assert.equal(
      unwrap(await pvfs.read("/b.md")).content,
      `B-new-${suffix}`,
      "project /b.md 内容应为 session 版本",
    );
    assert.equal(
      unwrap(await pvfs.read("/sub/c.md")).content,
      `C-${suffix}`,
      "session 新增子目录文件应推入 project",
    );

    // 推送不回写 session：session 树保持推送前状态
    const sPaths = unwrap(await svfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path)
      .sort();
    assert.deepEqual(sPaths, ["/b.md", "/sub/c.md"]);
  });

  it("T-WP2: 目录规则覆盖——push 后 project 规则 = session 版本", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = unwrap(await ctx.projects.create(`P-${suffix}`));
    const pvfs = ctx.projectVfs(project.id);
    unwrap(await pvfs.write("/b.md", `B-old-${suffix}`));

    const session = unwrap(await ctx.sessions.create(project.id));
    // create 之后才在 project 侧设独有规则（create 时会把 project 规则镜像进
    // session，放在 create 前就不再是「project 独有」了）。
    const pwt = createWorkplaceService(ctx.conn, {
      kind: "project",
      projectId: project.id,
    });
    unwrap(await pwt.setDirRule({ logicalPath: "/", ruleEnabled: true, headCount: 3 }));
    unwrap(await pwt.setFileRule({ logicalPath: "/b.md", inclusionMode: "hide" }));

    // session 侧规则：/ headCount=5 + /c.md show
    const svfs = ctx.sessionVfs(project.id, session.id);
    unwrap(await svfs.write("/c.md", `C-${suffix}`));
    const swt = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    unwrap(await swt.setDirRule({ logicalPath: "/", ruleEnabled: true, headCount: 5 }));
    unwrap(await swt.setFileRule({ logicalPath: "/c.md", inclusionMode: "show" }));

    await createTemplatePullService(ctx.conn).pushSessionTemplate(session.id);

    // push 后：project 规则 == session 版本（headCount=5），session 没有的规则被清除
    const projectDirRule = unwrap(await pwt.getDirRule("/"));
    assert.ok(projectDirRule != null, "project / 目录规则应存在");
    assert.equal(projectDirRule.headCount, 5, "project / headCount 应为 session 版本");
    // 规则层直接查 repository：session 没有的 /b.md hide 规则应被 copyScope 覆盖清除
    const wtRepo = new SqliteWorkplaceRepository(ctx.conn);
    const projectScopeKey = `project:${project.id}`;
    assert.equal(
      unwrap(await wtRepo.findFileRule(projectScopeKey, "/b.md")),
      null,
      "session 没有的 /b.md 文件规则应被清除",
    );
    const shownC = unwrap(await wtRepo.findFileRule(projectScopeKey, "/c.md"));
    assert.ok(shownC != null, "/c.md 文件规则应随推送落 project");
    assert.equal(shownC.inclusionMode, "show");
  });

  it("T-WP3: 推送链后无 orphan blob（deferred GC 路径）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = unwrap(await ctx.projects.create(`P-${suffix}`));
    const pvfs = ctx.projectVfs(project.id);
    unwrap(await pvfs.write("/a.md", `A-${suffix}`));

    const session = unwrap(await ctx.sessions.create(project.id));
    const svfs = ctx.sessionVfs(project.id, session.id);
    // session 改写 a + 新增文件，project 侧旧 blob 在推送替换后应被 sweep/GC 回收
    unwrap(await svfs.write("/a.md", `A2-${suffix}`));
    unwrap(await svfs.write("/new.md", `NEW-${suffix}`));

    await createTemplatePullService(ctx.conn).pushSessionTemplate(session.id);

    assert.equal(
      unwrap(await pvfs.read("/a.md")).content,
      `A2-${suffix}`,
      "project /a.md 应为 session 推送版本",
    );

    // 推送链后：所有 vfs_content_blob 行必须被某 revision 引用（无孤儿）
    const orphanRows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_content_blob b
       WHERE NOT EXISTS (
         SELECT 1 FROM vfs_revision r WHERE r.content_hash = b.content_hash
       )`,
    );
    assert.equal(
      Number(orphanRows[0]!.n),
      0,
      "pushSessionTemplate 后不应有 orphan blob",
    );
  });

  it("T-WP4a: 会话不存在走 Err 通道（CHAT_NOT_FOUND）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const pushed = await createTemplatePullService(ctx.conn).pushSessionTemplate(`missing-${suffix}`);
    assert.ok(!pushed.ok, "会话不存在应走 Err 通道");
    if (!pushed.ok) {
      assert.ok(isAppError(pushed.error, "CHAT_NOT_FOUND"), "应为 CHAT_NOT_FOUND");
    }
  });

  it("T-WP4b: 事务失败回滚——project 不留半态", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = unwrap(await ctx.projects.create(`P-${suffix}`));
    const pvfs = ctx.projectVfs(project.id);
    unwrap(await pvfs.write("/keep.md", `KEEP-${suffix}`));

    const session = unwrap(await ctx.sessions.create(project.id));
    const svfs = ctx.sessionVfs(project.id, session.id);
    unwrap(await svfs.write("/pushed.md", `PUSHED-${suffix}`));

    // 事务内推送（真在写库），随后人为抛错回滚
    await assert.rejects(
      ctx.conn.transaction(async (tx) => {
        await pushSessionWorkspace(tx, project.id, session.id);
        throw new Error("boom");
      }),
      /boom/,
    );

    // 回滚后：project 保持推送前原样（/keep.md 仍在、/pushed.md 未混入）
    const paths = unwrap(await pvfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path)
      .sort();
    assert.deepEqual(paths, ["/keep.md"], "回滚后 project 不应残留推送半态");
    assert.equal(
      unwrap(await pvfs.read("/keep.md")).content,
      `KEEP-${suffix}`,
      "回滚后原文件内容不变",
    );
  });
});
