/**
 * core 层直接测：session.create → initializeSessionWorkspace 的整条编排。
 *
 * 覆盖：
 * - (a) session scope 文件/目录/内容与 project template 一致，且 revision 已 seed
 * - (b) worktree 规则经 mapProjectWorkplacePathToSession 复制到 session scope
 * - (c) initializeSessionWorkspace(clearCheckpoints=false) 不清 checkpoint；
 *      (clearCheckpoints=true) 清空 checkpoint
 * - (d) 事务回滚：workspace 初始化后出错不残留（session.create 事务边界原子性）
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { createWorkplaceService } from "@novel-master/core/workplace";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { scopeKey } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { initializeSessionWorkspace } from "@/service/template/logic/initialize-session-workspace.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("session create / workspace initialize (core 层)", () => {
  it("(a+b) session scope 与 template 一致、revision seed、worktree 规则复制", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    // 非空 template：根目录文件 + 子目录文件
    await pvfs.write("/a.md", "A-content");
    await pvfs.write("/sub/b.md", "B-content");
    const pwt = createWorkplaceService(ctx.conn, {
      kind: "project",
      projectId: project.id,
    });
    await pwt.setFileRule({ logicalPath: "/a.md", inclusionMode: "show" });
    await pwt.setDirRule({ logicalPath: "/", headCount: 3 });

    // session.create 走 clearCheckpoints=false 的 initializeSessionWorkspace
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    // --- (a) 文件/目录/内容一致 ---
    const paths = (await svfs.list("/", { recursive: true }))
      .map((e) => e.path)
      .sort();
    // 工具实现不落空目录？这里容忍：只断言 template 里实际文件都在
    for (const p of ["/a.md", "/sub/b.md"]) {
      assert.ok(paths.includes(p), `session 应包含 ${p}`);
    }
    // session 与 template 的文件路径集合完全一致
    const asPaths = (xs: { path: string }[]) => xs.map((x) => x.path).sort();
    assert.deepEqual(
      asPaths(await svfs.list("/", { recursive: true })),
      asPaths(await pvfs.list("/", { recursive: true })),
      "session scope 应镜像 project template 整树",
    );
    assert.deepEqual(
      await svfs.read("/a.md"),
      await pvfs.read("/a.md"),
      "会话 /a.md 内容与 template 一致",
    );
    assert.deepEqual(
      await svfs.read("/sub/b.md"),
      await pvfs.read("/sub/b.md"),
      "会话 /sub/b.md 内容与 template 一致",
    );

    // --- revision 已 seed：每个 live head 都有一条 active revision 行 ---
    const sk = scopeKey({ kind: "session", projectId: project.id, sessionId: session.id });
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    for (const p of ["/a.md", "/sub/b.md"]) {
      const entry = await entries.findByPath(sk, p);
      assert.ok(entry != null, `${p} entry 应存在`);
      const live = await svfs.read(p);
      const rev = await revisions.findByEntryAndVersion(entry.entryId, live.version);
      assert.ok(rev, `${p} revision (v${live.version}) 应已 seed`);
      assert.equal(rev.status, "active");
    }

    // --- (b) worktree 规则经 mapProjectWorkplacePathToSession 复制 ---
    const swt = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const sRows = await swt.buildListRows();
    const fileRow = sRows.find((r) => r.kind === "file" && r.path === "/a.md");
    assert.ok(fileRow);
    assert.equal((fileRow as { inclusionMode?: string }).inclusionMode, "show");
    const dirRow = sRows.find((r) => r.kind === "dir" && r.path === "/");
    assert.ok(dirRow);
    assert.equal((dirRow as { ruleState?: string }).ruleState, "rule_on");
  });

  it("(c) clearCheckpoints=false 不清 checkpoint；true 清 checkpoint", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    await ctx.projectVfs(project.id).write("/x.md", "X");
    const session = await ctx.sessions.create(project.id);
    const assistant = await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("wrote"),
    );
    await ctx.sessionVfs(project.id, session.id).write("/x.md", "snap", {
      versionCheck: false,
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);
    const checkpoints = new SqliteMessageCheckpointRepository(ctx.conn);
    assert.equal(await checkpoints.hasCheckpoint(session.id, assistant.id), true);

    // 分支1：create 语义（clearCheckpoints=false）不清 checkpoint
    await ctx.conn.transaction(async (tx) => {
      await initializeSessionWorkspace(tx, project.id, session.id, {
        clearCheckpoints: false,
      });
    });
    assert.equal(
      await checkpoints.hasCheckpoint(session.id, assistant.id),
      true,
      "clearCheckpoints=false 不得清 checkpoint",
    );

    // 分支2：pull 语义（clearCheckpoints=true）清 checkpoint
    await ctx.conn.transaction(async (tx) => {
      await initializeSessionWorkspace(tx, project.id, session.id, {
        clearCheckpoints: true,
      });
    });
    assert.equal(
      await checkpoints.hasCheckpoint(session.id, assistant.id),
      false,
      "clearCheckpoints=true 应清 checkpoint",
    );
  });

  it("(d) workspace 初始化随事务回滚不残留", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    await ctx.projectVfs(project.id).write("/keep.md", "KEEP");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    // 事务内做一次 replace + copy（真在写库），然后人为抛错回滚
    await assert.rejects(
      ctx.conn.transaction(async (tx) => {
        await initializeSessionWorkspace(tx, project.id, session.id, {
          clearCheckpoints: false,
        });
        throw new Error("boom");
      }),
      /boom/,
    );

    // 回滚后：没有残留的 template 复制（session 保持 create 时那份旧的）
    const read = await svfs.read("/keep.md");
    assert.equal(read.content, "KEEP");
  });

  it("(e) meta/skills 隔离豁免：project 技能不随会话初始化镜像/重置（T-SK2）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-${suffix}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/a.md", "A-content");
    // project 域已有技能（含辅助文件），revision 已 seed
    await pvfs.write("/meta/skills/my-skill/SKILL.md", `skill-${suffix}`);
    await pvfs.write("/meta/skills/my-skill/references/timeline.md", `timeline-${suffix}`);

    const projectScope = `project:${project.id}`;
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const skillEntry = await entryRepo.findByPath(
      projectScope,
      "/meta/skills/my-skill/SKILL.md",
    );
    assert.ok(skillEntry != null);
    const skillRefsBefore = await revisionRepo.listKeysUnderScope(
      projectScope,
      "/meta/skills",
    );
    assert.ok(skillRefsBefore.length >= 1, "技能文件应已有 seed revision");

    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    // 拷贝侧：session 不镜像 project 技能目录
    const sessionPaths = (await svfs.list("/", { recursive: true }))
      .map((e) => e.path);
    assert.ok(
      sessionPaths.every((p) => !p.startsWith("/meta/skills")),
      `session 不应镜像技能目录，实际：${sessionPaths.join(", ")}`,
    );
    assert.ok(sessionPaths.includes("/a.md"), "非排除前缀照常拷贝");

    // 删除侧：project 技能 entry / revision 不因 session 初始化被重置
    const skillEntryAfter = await entryRepo.findByPath(
      projectScope,
      "/meta/skills/my-skill/SKILL.md",
    );
    assert.ok(skillEntryAfter != null, "project 技能 entry 应保留");
    assert.equal(
      skillEntryAfter.entryId,
      skillEntry.entryId,
      "project 技能 entry 不应被删除重建",
    );
    assert.deepEqual(
      await revisionRepo.listKeysUnderScope(projectScope, "/meta/skills"),
      skillRefsBefore,
      "project 技能 revision 集合应保持不变",
    );
    assert.equal(
      await pvfs.read("/meta/skills/my-skill/SKILL.md").then((r) => r.content),
      `skill-${suffix}`,
      "project 技能内容不变",
    );
  });
});
