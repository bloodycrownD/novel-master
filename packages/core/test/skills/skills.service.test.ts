/**
 * SkillService 集成测试（T-SK5）。
 *
 * 覆盖：listSkills 清单与有效性、read 生效副本解析、`..` 路径拒绝、
 * write 缺域报错、SKILL_NAME_PATTERN 校验、edit 局部改、setDisabled /
 * effectiveSkills、copySkill 整包覆盖、deleteSkill 清理负清单。
 *
 * @module test/skills/skills.service
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSkillsService } from "@novel-master/core/skills";
import { SkillError } from "@novel-master/core/skills";
import { isVfsError } from "@novel-master/core/vfs";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

const VALID_SKILL_MD = `---
name: demo-skill
description: 演示技能
---

# 演示技能正文
`;

function entry(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n正文\n`;
}

describe("SkillService（T-SK5）", () => {
  it("write 新建技能（缺省 SKILL.md）后 listSkills 可见且有效", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const name = `new-skill-${testIsolationSuffix()}`;

    await skills.writeSkillFile("global", name, undefined, VALID_SKILL_MD);

    const list = await skills.listSkills("global");
    const item = list.find((s) => s.name === name);
    assert.ok(item != null, "新建技能应出现在全局清单");
    assert.equal(item.valid, true);
    assert.equal(item.description, "演示技能");
    assert.deepEqual(item.files, ["SKILL.md"]);
  });

  it("listSkills：front matter 坏 / 缺 SKILL.md 的技能标无效", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();

    await skills.writeSkillFile(
      "global",
      `bad-fm-${suffix}`,
      undefined,
      "没有 front matter 的正文",
    );
    // 只有辅助文件、没有 SKILL.md 的技能目录
    await ctx.globalVfs().write(
      `/meta/skills/no-entry-${suffix}/notes.md`,
      "辅助文件",
    );

    const list = await skills.listSkills("global");
    const badFm = list.find((s) => s.name === `bad-fm-${suffix}`);
    assert.ok(badFm != null);
    assert.equal(badFm.valid, false);
    assert.ok(badFm.invalidReason != null);

    const noEntry = list.find((s) => s.name === `no-entry-${suffix}`);
    assert.ok(noEntry != null);
    assert.equal(noEntry.valid, false);
    assert.deepEqual(noEntry.files, ["notes.md"]);
  });

  it("write 缺域报错（MISSING_DOMAIN）", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);

    await assert.rejects(
      () =>
        skills.writeSkillFile(
          undefined,
          `no-domain-${testIsolationSuffix()}`,
          undefined,
          VALID_SKILL_MD,
        ),
      (error: unknown) =>
        error instanceof SkillError && error.code === "MISSING_DOMAIN",
    );
  });

  it("read/write 的 `..` 路径拒绝且不得逃逸技能目录", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const name = `path-guard-${testIsolationSuffix()}`;
    await skills.writeSkillFile("global", name, undefined, VALID_SKILL_MD);

    // read：显式 .. 段
    await assert.rejects(
      () => skills.readSkillFile("global", name, "../other/SKILL.md"),
      (error: unknown) =>
        error instanceof SkillError && error.code === "INVALID_PATH",
    );
    // write：`..` 会被 normalizePath 静默消化成回溯，必须在这里拦截
    await assert.rejects(
      () =>
        skills.writeSkillFile(
          "global",
          name,
          "notes/../../victim.md",
          "逃逸内容",
        ),
      (error: unknown) =>
        error instanceof SkillError && error.code === "INVALID_PATH",
    );
    // edit 同样拒绝
    await assert.rejects(
      () =>
        skills.editSkillFile("global", name, "../SKILL.md", {
          oldString: "a",
          newString: "b",
        }),
      (error: unknown) =>
        error instanceof SkillError && error.code === "INVALID_PATH",
    );
    // 隔壁技能目录未被写脏
    await assert.rejects(
      () => ctx.globalVfs().read("/meta/skills/victim.md"),
      (error: unknown) => isVfsError(error, "NOT_FOUND"),
    );
  });

  it("write 新建技能名须过 SKILL_NAME_PATTERN 校验", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);

    for (const bad of [".hidden", "has space", "a/b", "SKILL.md"]) {
      await assert.rejects(
        () => skills.writeSkillFile("global", bad, undefined, VALID_SKILL_MD),
        (error: unknown) =>
          error instanceof SkillError && error.code === "INVALID_NAME",
        `技能名 ${bad} 应被拒绝`,
      );
    }
  });

  it("read 域缺省按生效副本解析：同名项目副本优先，显式域读原件", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-${suffix}`);
    const name = `dual-${suffix}`;

    await skills.writeSkillFile(
      "global",
      name,
      undefined,
      entry(name, "全局版"),
    );
    await skills.writeSkillFile(
      "project",
      name,
      undefined,
      entry(name, "项目版"),
      project.id,
    );

    // 域缺省：项目副本优先
    const effective = await skills.readSkillFile(
      undefined,
      name,
      undefined,
      project.id,
    );
    assert.equal(effective.domain, "project");
    assert.match(effective.content, /项目版/);

    // 显式 global：读全局原件
    const globalCopy = await skills.readSkillFile("global", name);
    assert.equal(globalCopy.domain, "global");
    assert.match(globalCopy.content, /全局版/);

    // 项目无同名副本时回落 global
    const other = await ctx.projects.create(`P2-${suffix}`);
    const fallback = await skills.readSkillFile(
      undefined,
      name,
      undefined,
      other.id,
    );
    assert.equal(fallback.domain, "global");

    // 不存在：NOT_FOUND
    await assert.rejects(
      () =>
        skills.readSkillFile(undefined, `missing-${suffix}`, undefined, project.id),
      (error: unknown) =>
        error instanceof SkillError && error.code === "NOT_FOUND",
    );
  });

  it("editSkillFile 局部修改（normalize-for-match 语义）", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const name = `edit-${testIsolationSuffix()}`;
    await skills.writeSkillFile("global", name, undefined, VALID_SKILL_MD);

    const result = await skills.editSkillFile("global", name, undefined, {
      oldString: "演示技能正文",
      newString: "改过的正文",
    });
    assert.equal(result.replacements, 1);

    const read = await skills.readSkillFile("global", name);
    assert.match(read.content, /改过的正文/);
    assert.doesNotMatch(read.content, /演示技能正文/);
    // front matter 未动，技能仍有效
    const item = (await skills.listSkills("global")).find(
      (s) => s.name === name,
    );
    assert.ok(item != null && item.valid);
  });

  it("setDisabled + effectiveSkills：落行/删行与合并视图联动", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-${suffix}`);

    await skills.writeSkillFile("global", "g-skill", undefined, entry("g-skill", "全局技能"));
    await skills.writeSkillFile(
      "project",
      "p-skill",
      undefined,
      entry("p-skill", "项目技能"),
      project.id,
    );

    let view = await skills.effectiveSkills(project.id);
    const gSkill = view.find((s) => s.name === "g-skill");
    const pSkill = view.find((s) => s.name === "p-skill");
    assert.ok(gSkill != null && pSkill != null);
    assert.equal(gSkill.effective, true);
    assert.equal(pSkill.effective, true);
    assert.equal(pSkill.domain, "project");

    await skills.setDisabled(project.id, "g-skill", true);
    view = await skills.effectiveSkills(project.id);
    const disabledOne = view.find((s) => s.name === "g-skill");
    assert.ok(disabledOne != null);
    assert.equal(disabledOne.disabled, true);
    assert.equal(disabledOne.effective, false);

    await skills.setDisabled(project.id, "g-skill", false);
    view = await skills.effectiveSkills(project.id);
    assert.equal(view.find((s) => s.name === "g-skill")?.effective, true);
  });

  it("copySkill 整目录复制：目标同名整包覆盖（旧文件清除）", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-${suffix}`);

    // 源：global 技能，带辅助子目录文件
    await skills.writeSkillFile("global", "src-skill", undefined, entry("src-skill", "源描述"));
    await ctx.globalVfs().write(
      "/meta/skills/src-skill/guide/usage.md",
      "用法说明",
    );
    // 目标：project 域已有同名技能，内容不同 + 目标独有的旧文件
    await skills.writeSkillFile(
      "project",
      "src-skill",
      undefined,
      entry("src-skill", "项目旧版"),
      project.id,
    );
    await ctx.projectVfs(project.id).write(
      "/meta/skills/src-skill/legacy.md",
      "旧文件应被整包覆盖清掉",
    );

    await skills.copySkill(
      { domain: "global", name: "src-skill" },
      { domain: "project", projectId: project.id, name: "src-skill" },
    );

    const projectList = await skills.listSkills({ projectId: project.id });
    const copied = projectList.find((s) => s.name === "src-skill");
    assert.ok(copied != null);
    assert.equal(copied.description, "源描述", "SKILL.md 应为源版本");
    // 目标独有的 legacy.md 被整包覆盖清除；源的子目录文件带上
    assert.deepEqual(copied.files, ["SKILL.md", "guide/usage.md"]);
    const usage = await skills.readSkillFile(
      "project",
      "src-skill",
      "guide/usage.md",
      project.id,
    );
    assert.equal(usage.content, "用法说明");
  });

  it("copySkill 目标名非法 / 源不存在时报错", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();

    await skills.writeSkillFile("global", "copy-src", undefined, entry("copy-src", "源"));
    await assert.rejects(
      () =>
        skills.copySkill(
          { domain: "global", name: "copy-src" },
          { domain: "global", name: ".bad-name" },
        ),
      (error: unknown) =>
        error instanceof SkillError && error.code === "INVALID_NAME",
    );
    await assert.rejects(
      () =>
        skills.copySkill(
          { domain: "global", name: `missing-${suffix}` },
          { domain: "global", name: "copy-dst" },
        ),
      (error: unknown) =>
        error instanceof SkillError && error.code === "NOT_FOUND",
    );
  });

  it("deleteSkill project 域：清目录且只清本项目负清单行", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const p1 = await ctx.projects.create(`P1-${suffix}`);
    const p2 = await ctx.projects.create(`P2-${suffix}`);

    await skills.writeSkillFile(
      "project",
      "del-skill",
      undefined,
      entry("del-skill", "待删"),
      p1.id,
    );
    // 同名技能种在另一个项目（负清单行也落一份），删除 p1 不应影响它
    await skills.writeSkillFile(
      "project",
      "del-skill",
      undefined,
      entry("del-skill", "另一个项目的同名技能"),
      p2.id,
    );
    await skills.setDisabled(p1.id, "del-skill", true);
    await skills.setDisabled(p2.id, "del-skill", true);

    await skills.deleteSkill({ domain: "project", projectId: p1.id, name: "del-skill" });

    const p1List = await skills.listSkills({ projectId: p1.id });
    assert.equal(p1List.find((s) => s.name === "del-skill"), undefined);

    // p1 的负清单行被清理；p2 的技能与负清单行原样保留
    const p1View = await skills.effectiveSkills(p1.id);
    assert.equal(p1View.find((s) => s.name === "del-skill"), undefined);
    const p2View = await skills.effectiveSkills(p2.id);
    const p2Item = p2View.find((s) => s.name === "del-skill");
    assert.ok(p2Item != null);
    assert.equal(p2Item.disabled, true);

    // 删除后原目录不可读
    await assert.rejects(
      () => skills.readSkillFile("project", "del-skill", undefined, p1.id),
      (error: unknown) =>
        error instanceof SkillError && error.code === "NOT_FOUND",
    );
  });

  it("deleteSkill global 域：清所有项目的同名负清单行", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const p1 = await ctx.projects.create(`PG1-${suffix}`);
    const p2 = await ctx.projects.create(`PG2-${suffix}`);

    await skills.writeSkillFile("global", "g-del", undefined, entry("g-del", "全局待删"));
    await skills.setDisabled(p1.id, "g-del", true);
    await skills.setDisabled(p2.id, "g-del", true);

    await skills.deleteSkill({ domain: "global", name: "g-del" });

    // 直接查表确认负清单行全清（listDisabledNames 无公开 service 入口）
    const rows = await ctx.conn.query<{ scope_key: string }>(
      "SELECT scope_key FROM skill_disabled_rule WHERE skill_name = 'g-del'",
    );
    assert.equal(rows.length, 0, "global 技能删除后所有项目的负清单行都应清理");

    const globalList = await skills.listSkills("global");
    assert.equal(globalList.find((s) => s.name === "g-del"), undefined);
  });

  it("project 域操作缺 projectId 报错", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);

    await assert.rejects(
      () =>
        skills.writeSkillFile("project", "no-pid", undefined, VALID_SKILL_MD),
      (error: unknown) =>
        error instanceof SkillError && error.code === "MISSING_PROJECT_ID",
    );
  });
});
