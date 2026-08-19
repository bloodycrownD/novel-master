/**
 * 技能存储重定位（T-SR1 / T-SR3，Step 1 — phase-skill-relocate）。
 *
 * - T-SR1：global 技能落 `global:meta` 域（物理 `/meta/skills/...`）、
 *   project 技能落 `project:{pid}:meta` 域（物理 `/projects/{pid}/meta/skills/...`）；
 *   上层（effectiveSkills / readSkillFile / 项目副本覆盖）行为不变。
 * - T-SR3：`ProjectService.delete()` 后 `project:{pid}:meta` 与 `project:{pid}`、
 *   `session:{pid}:{sid}` 同样零 entry 残留；随后的 `runDeferredBlobGc`
 *   后无 orphan blob。
 *
 * @module test/skills/skill-relocate
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSkillsService } from "@novel-master/core/skills";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { runDeferredBlobGc } from "@/domain/vfs/logic/deferred-blob-gc.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function entry(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n正文\n`;
}

describe("技能存储重定位（T-SR1）", () => {
  it("global 技能落 global:meta 域，物理路径 /meta/skills/...", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const name = `g-relocate-${suffix}`;

    await skills.writeSkillFile("global", name, undefined, entry(name, "全局"));

    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const rows = await entryRepo.listEntriesUnderPrefix(
      "global:meta",
      "/meta/skills",
    );
    const row = rows.find((e) => e.path === `/meta/skills/${name}/SKILL.md`);
    assert.ok(row != null, "global 技能应落 global:meta 域");
    // listEntriesUnderPrefix 返回逻辑路径；物理路径经 mapper 校验
    const oldDomainRows = await entryRepo.listEntriesUnderPrefix(
      "global",
      "/meta/skills",
    );
    assert.equal(
      oldDomainRows.filter((e) => e.path.startsWith("/meta/skills")).length,
      0,
      "global 技能不应再落旧 global 域",
    );

    // 上层行为不变：清单可见且有效
    const list = await skills.listSkills("global");
    const item = list.find((s) => s.name === name);
    assert.ok(item != null && item.valid);
    const read = await skills.readSkillFile("global", name);
    assert.match(read.content, /name: g-relocate-/);
  });

  it("project 技能落 project:{pid}:meta 域，物理路径 /projects/{pid}/meta/skills/...", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-sr1-${suffix}`);
    const name = `p-relocate-${suffix}`;

    await skills.writeSkillFile(
      "project",
      name,
      undefined,
      entry(name, "项目"),
      project.id,
    );

    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const metaRows = await entryRepo.listEntriesUnderPrefix(
      `project:${project.id}:meta`,
      "/meta/skills",
    );
    assert.ok(
      metaRows.some((e) => e.path === `/meta/skills/${name}/SKILL.md`),
      "project 技能应落 project:{pid}:meta 域",
    );
    const templateRows = await entryRepo.listEntriesUnderPrefix(
      `project:${project.id}`,
      "/meta/skills",
    );
    assert.equal(
      templateRows.filter((e) => e.path.startsWith("/meta/skills")).length,
      0,
      "project 技能不应再落 project template 域",
    );

    // 上层行为不变：合并视图可见；域缺省读取项目副本优先、无副本回落 global
    const globalName = `g-fallback-${suffix}`;
    await skills.writeSkillFile(
      "global",
      globalName,
      undefined,
      entry(globalName, "全局回落"),
    );
    const view = await skills.effectiveSkills(project.id);
    assert.ok(view.find((s) => s.name === name)?.effective);
    const fallback = await skills.readSkillFile(
      undefined,
      globalName,
      undefined,
      project.id,
    );
    assert.equal(fallback.domain, "global");
    const projectCopy = await skills.readSkillFile(
      undefined,
      name,
      undefined,
      project.id,
    );
    assert.equal(projectCopy.domain, "project");
  });

  it("deleteSkill 清 meta 域 VFS 且负清单行沿用 project:{pid} 语义", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-del2-${suffix}`);
    const name = `del-meta-${suffix}`;

    await skills.writeSkillFile(
      "project",
      name,
      undefined,
      entry(name, "待删"),
      project.id,
    );
    await skills.setDisabled(project.id, name, true);

    await skills.deleteSkill({ domain: "project", projectId: project.id, name });

    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const metaRows = await entryRepo.listEntriesUnderPrefix(
      `project:${project.id}:meta`,
      "/meta/skills",
    );
    assert.equal(
      metaRows.filter((e) => e.path.startsWith(`/meta/skills/${name}`)).length,
      0,
      "meta 域技能 entry 应被清理",
    );
    // 负清单行同删：重建同名技能不会被意外禁用
    const rows = await ctx.conn.query<{ scope_key: string }>(
      "SELECT scope_key FROM skill_disabled_rule WHERE skill_name = ?",
      [name],
    );
    assert.equal(rows.length, 0, "删除技能后禁用行应清理");

    // 重建同名技能：默认生效
    await skills.writeSkillFile(
      "project",
      name,
      undefined,
      entry(name, "重建"),
      project.id,
    );
    const view = await skills.effectiveSkills(project.id);
    const rebuilt = view.find((s) => s.name === name);
    assert.ok(rebuilt != null);
    assert.notEqual(rebuilt.disabled, true, "重建技能不应被残留禁用行误伤");
  });
});

describe("项目删除无孤儿（T-SR3）", () => {
  it("delete 后 project:{pid}:meta / project:{pid} / session:{pid}:{sid} 零 entry 残留", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-sr3-${suffix}`);

    // 三域都种上内容：template 文件、meta 技能、session 文件
    await ctx.projectVfs(project.id).write("/novel.md", "正文");
    await skills.writeSkillFile(
      "project",
      `sr3-skill-${suffix}`,
      undefined,
      entry(`sr3-skill-${suffix}`, "随项目删除"),
      project.id,
    );
    const session = await ctx.sessions.create(project.id);
    await ctx.sessionVfs(project.id, session.id).write("/draft.md", "草稿");

    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    for (const scopeKey of [
      `project:${project.id}`,
      `project:${project.id}:meta`,
      `session:${project.id}:${session.id}`,
    ]) {
      const before = await entryRepo.listEntriesUnderPrefix(scopeKey, "/");
      assert.ok(before.length > 0, `${scopeKey} 删除前应有 entry`);
    }

    await ctx.projects.delete(project.id);

    for (const scopeKey of [
      `project:${project.id}`,
      `project:${project.id}:meta`,
      `session:${project.id}:${session.id}`,
    ]) {
      const after = await entryRepo.listEntriesUnderPrefix(scopeKey, "/");
      assert.equal(
        after.filter((e) => e.path.startsWith("/")).length,
        0,
        `${scopeKey} 删除后不应残留 entry`,
      );
    }

    // delete() 事务提交后已调度过一次 GC；这里再显式跑一遍幂等的
    // runDeferredBlobGc，按全库引用集（entry ∪ revision 反查）验证无 orphan blob。
    await runDeferredBlobGc(ctx.conn);
    const orphanRows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_content_blob b
       WHERE NOT EXISTS (
         SELECT 1 FROM vfs_revision r WHERE r.content_hash = b.content_hash
       )`,
    );
    assert.equal(
      Number(orphanRows[0]!.n),
      0,
      "runDeferredBlobGc 后不应有 orphan blob",
    );
  });
});
