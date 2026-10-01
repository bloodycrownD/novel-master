import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";

import { createTemplatePullService, createWorkplaceService } from "@novel-master/core/workplace";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { assembleWorkplaceDisplay } from "@/service/workplace/assemble-workplace-display.js";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  SESSION_KKV_DOMAIN_USAGE_STATS,
  USAGE_STATS_TOOL_USE_COUNT_KEY,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

/** 组装一次常驻工作区前缀（返回 <workplace> 包裹的展示串）。 */
async function assembleWorkplace(
  projectId: string,
  sessionId: string
): Promise<string> {
  const ctx = getNovelMasterTestContext();
  return (
    await assembleWorkplaceDisplay(
      { kind: "session", projectId, sessionId },
      {
        sessionKkv: createSessionKkvService(ctx.conn),
        workplace: createWorkplaceService(ctx.conn, {
          kind: "session",
          projectId,
          sessionId,
        }),
        vfs: ctx.sessionVfs(projectId, sessionId),
        layout: { workplace: "<workplace>" },
      }
    )
  ).workplaceDisplay;
}

/** 让出若干宏任务，等 assemble 的 fire-and-forget file_cache 回填落库。 */
async function flushDeferredBackfill(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** 让 session 工作区的 /a.md 以 full 档进入规则快照。 */
async function pinFullRule(
  projectId: string,
  sessionId: string,
  path: string
): Promise<void> {
  const ctx = getNovelMasterTestContext();
  const swt = createWorkplaceService(ctx.conn, {
    kind: "session",
    projectId,
    sessionId,
  });
  await swt.setDirRule({ logicalPath: "/", headCount: 2 });
  await swt.setFileRule({ logicalPath: path, inclusionMode: "show" });
}

describe("template pull", () => {
  it("session create copies worktree with path mapping", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    await ctx.projectVfs(project.id).write("/a.md", "A");
    const pwt = createWorkplaceService(ctx.conn, {
      kind: "project",
      projectId: project.id,
    });
    await pwt.setDirRule({
      logicalPath: "/",
      headCount: 2,
    });
    await pwt.setFileRule({
      logicalPath: "/a.md",
      inclusionMode: "show",
    });

    const session = await ctx.sessions.create(project.id);
    const swt = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const rows = await swt.buildListRows();
    const fileRow = rows.find((r) => r.kind === "file" && r.path === "/a.md");
    assert.ok(fileRow);
    assert.equal(fileRow.inclusionMode, "show");
    const dirRoot = rows.find((r) => r.kind === "dir" && r.path === "/");
    assert.ok(dirRoot);
    assert.equal(dirRoot.ruleState, "rule_on");
  });

  it("session pull clears message checkpoints but keeps messages", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    await ctx.projectVfs(project.id).write("/x.md", "X");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/only.md", "local");
    await ctx.messages.append(session.id, "user", textBlocks("hi"));
    const assistant = await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("wrote"),
    );
    await svfs.write("/x.md", "snap", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);
    const checkpointRepo = new SqliteMessageCheckpointRepository(ctx.conn);
    assert.equal(
      await checkpointRepo.hasCheckpoint(session.id, assistant.id),
      true,
    );

    await ctx.projectVfs(project.id).write("/x.md", "NEW", {
      versionCheck: false,
    });
    await createTemplatePullService(ctx.conn).sessionTemplatePull(session.id);

    const paths = (await svfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path);
    assert.deepEqual(paths, ["/x.md"]);
    assert.equal((await svfs.read("/x.md")).content, "NEW");
    assert.equal((await ctx.messages.listBySession(session.id)).length, 2);
    assert.equal(
      (await checkpointRepo.listFilePointersForSession(session.id)).length,
      0,
    );
  });

  it("session create 仅复制 template 文件", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    await ctx.projectVfs(project.id).write("/a.md", "A");
    await ctx.projectVfs(project.id).write("/b.md", "B");

    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const paths = (await svfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path)
      .sort();
    assert.deepEqual(paths, ["/a.md", "/b.md"]);
  });

  it("session pull replace 语义移除 session 独有孤儿文件", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    await ctx.projectVfs(project.id).write("/a.md", "A");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/orphan.md", "orphan");

    await createTemplatePullService(ctx.conn).sessionTemplatePull(session.id);

    const paths = (await svfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path)
      .sort();
    assert.deepEqual(paths, ["/a.md"]);
  });

  // ---- RT-08：模板拉取是 session scope 的整树覆盖，必须对齐 prompt 缓存 ----

  it("T-P1: 模板拉取后 rule_snapshot / file_cache 两域被清空", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-${suffix}`);
    await ctx.projectVfs(project.id).write("/a.md", `A-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    await pinFullRule(project.id, session.id, "/a.md");

    // 先组装一次，让 rule_snapshot + file_cache 两域都有真实行
    const before = await assembleWorkplace(project.id, session.id);
    assert.ok(before.includes("A-"), "前置条件：组装应命中 /a.md 的正文");
    await flushDeferredBackfill();
    const kkv = createSessionKkvService(ctx.conn);
    assert.ok(
      (await kkv.listKeys(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT)).length > 0,
      "前置条件：rule_snapshot 域应有行",
    );
    assert.ok(
      (await kkv.listKeys(session.id, SESSION_KKV_DOMAIN_FILE_CACHE)).length > 0,
      "前置条件：file_cache 域应有行",
    );

    await createTemplatePullService(ctx.conn).sessionTemplatePull(session.id);

    assert.equal(
      (await kkv.listKeys(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT)).length,
      0,
      "拉取后 rule_snapshot 域应被清空",
    );
    assert.equal(
      (await kkv.listKeys(session.id, SESSION_KKV_DOMAIN_FILE_CACHE)).length,
      0,
      "拉取后 file_cache 域应被清空",
    );
  });

  it("T-P2: 模板拉取后 usage_stats.toolUseCount 被写哨兵空串", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-${suffix}`);
    await ctx.projectVfs(project.id).write("/a.md", `A-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const kkv = createSessionKkvService(ctx.conn);
    await kkv.set(
      session.id,
      SESSION_KKV_DOMAIN_USAGE_STATS,
      USAGE_STATS_TOOL_USE_COUNT_KEY,
      "42"
    );

    await createTemplatePullService(ctx.conn).sessionTemplatePull(session.id);

    assert.equal(
      await kkv.get(
        session.id,
        SESSION_KKV_DOMAIN_USAGE_STATS,
        USAGE_STATS_TOOL_USE_COUNT_KEY,
      ),
      "",
      "拉取后 toolUseCount 应被写哨兵空串（失效协议是哨兵而非 delete）",
    );
  });

  it("T-P3: 同路径内容变更后拉取，workplace 前缀不再命中陈旧 file_cache", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-${suffix}`);
    await ctx.projectVfs(project.id).write("/a.md", `v1-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    await pinFullRule(project.id, session.id, "/a.md");

    // 第一次组装：file_cache 缓存住 v1
    const first = await assembleWorkplace(project.id, session.id);
    assert.ok(
      first.includes(`v1-${suffix}`),
      "前置条件：首次组装应注入 v1 正文",
    );
    // 关键前置条件：file_cache 必须真的落了行，否则第二次组装是走 miss 回填、
    // 本用例就成了一条测不到「陈旧缓存续命」的废断言。
    await flushDeferredBackfill();
    assert.ok(
      (
        await createSessionKkvService(ctx.conn).listKeys(
          session.id,
          SESSION_KKV_DOMAIN_FILE_CACHE,
        )
      ).length > 0,
      "前置条件：首次组装后 file_cache 域应有行（否则本用例无牙齿）",
    );

    // 项目模板侧改同一路径的正文（不显式固定 mtime：file_cache 读口
    // 命中即无条件返回、全程不比对 mtime，「同路径内容一改就命中陈旧缓存」
    // 本来就是最强形态、也是真实发生的形态）
    await ctx
      .projectVfs(project.id)
      .write("/a.md", `v2-${suffix}`, { versionCheck: false });

    await createTemplatePullService(ctx.conn).sessionTemplatePull(session.id);

    const second = await assembleWorkplace(project.id, session.id);
    assert.ok(
      second.includes(`v2-${suffix}`),
      "拉取后组装应注入新正文 v2（核心断言：陈旧 file_cache 不得续命）",
    );
    assert.ok(
      !second.includes(`v1-${suffix}`),
      "拉取后组装不得再注入已被替换掉的旧正文 v1",
    );
  });

  // 跨切面（CS-04）：模板拉取走 replaceVfsSubtree → sweepRevisionsUnderScope，
  // GC 换序后它必须真的回收 revision，而不是留一批 ref_count=0 的残留。
  it("模板拉取后 session scope 无 ref_count=0 的残留 revision", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-${suffix}`);
    await ctx.projectVfs(project.id).write("/a.md", `A-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const sessionScope = `session:${project.id}:${session.id}`;
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);

    // 会话侧独有的文件：pull 时整树替换会把它连同 live-head revision 一起清掉
    await ctx
      .sessionVfs(project.id, session.id)
      .write("/orphan.md", `orphan-${suffix}`);
    const orphan = await entryRepo.findByPath(sessionScope, "/orphan.md");
    assert.ok(orphan != null, "前置条件：会话侧孤儿文件应存在");
    const orphanVersion = await revisionRepo.findMaxVersionForEntry(
      orphan.entryId,
    );
    assert.ok(orphanVersion != null, "前置条件：孤儿文件应有 live-head revision");

    await createTemplatePullService(ctx.conn).sessionTemplatePull(session.id);

    const rows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM vfs_revision r
       WHERE r.ref_count <= 0
         AND NOT EXISTS (
           SELECT 1 FROM vfs_entry e WHERE e.entry_id = r.entry_id
         )`,
    );
    assert.equal(
      Number(rows[0]!.n),
      0,
      "模板拉取后不应残留 ref_count=0 的 entry-orphan revision",
    );
    const orphanRows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [orphan.entryId, orphanVersion],
    );
    assert.equal(
      Number(orphanRows[0]!.n),
      0,
      "模板拉取后孤儿文件的 live-head revision 应被回收",
    );
  });
});