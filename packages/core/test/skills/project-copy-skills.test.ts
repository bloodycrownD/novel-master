/**
 * 项目复制携带技能与负清单（T-SK6 / 设计决策 D1）。
 *
 * - 项目 copy 后：项目域技能文件随 "/" 整树复制到新项目、
 *   skill_disabled_rule 行按 scope_key 一并复制。
 * - sessions 不复制（copy 不变量保持），负清单行不串项目。
 *
 * @module test/skills/project-copy-skills
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSkillsService } from "@novel-master/core/skills";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function entry(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n正文\n`;
}

describe("项目复制携带技能与负清单（T-SK6 / D1）", () => {
  it("copy 后技能与禁用行都在，且与源项目互不影响", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const source = await ctx.projects.create(`P-${suffix}`);

    // 项目域技能（SKILL.md + 辅助文件）
    await skills.writeSkillFile(
      "project",
      "novel-helper",
      undefined,
      entry("novel-helper", "项目技能"),
      source.id,
    );
    await ctx.projectVfs(source.id).write(
      "/meta/skills/novel-helper/prompt.md",
      "辅助提示词",
    );
    // 同名 global 技能被项目副本覆盖 + 一条禁用行 + 一条无关禁用行
    await skills.writeSkillFile(
      "global",
      "shared-tool",
      undefined,
      entry("shared-tool", "全局版"),
    );
    await skills.writeSkillFile(
      "project",
      "shared-tool",
      undefined,
      entry("shared-tool", "项目覆盖版"),
      source.id,
    );
    await skills.setDisabled(source.id, "shared-tool", true);
    await skills.setDisabled(source.id, "novel-helper", true);

    const copy = await ctx.projects.copy(source.id);

    // 技能文件随整树复制到新项目
    const copyList = await skills.listSkills({ projectId: copy.id });
    const helper = copyList.find((s) => s.name === "novel-helper");
    assert.ok(helper != null, "项目技能应随复制携带");
    assert.equal(helper.valid, true);
    assert.deepEqual(helper.files, ["SKILL.md", "prompt.md"]);
    const copiedPrompt = await skills.readSkillFile(
      "project",
      "novel-helper",
      "prompt.md",
      copy.id,
    );
    assert.equal(copiedPrompt.content, "辅助提示词");

    // 负清单行按 scope_key 复制：新项目里同名禁用行生效
    const copyView = await skills.effectiveSkills(copy.id);
    assert.equal(copyView.find((s) => s.name === "novel-helper")?.disabled, true);
    assert.equal(copyView.find((s) => s.name === "shared-tool")?.domain, "project");

    // 副本禁用行独立于源：副本里关掉，源不受影响
    await skills.setDisabled(copy.id, "novel-helper", false);
    const sourceView = await skills.effectiveSkills(source.id);
    assert.equal(
      sourceView.find((s) => s.name === "novel-helper")?.disabled,
      true,
      "源项目禁用行不应被副本操作改动",
    );
    const copyViewAfter = await skills.effectiveSkills(copy.id);
    assert.equal(
      copyViewAfter.find((s) => s.name === "novel-helper")?.disabled,
      false,
    );
  });

  it("copy 不携带 sessions，负清单行不串项目", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const source = await ctx.projects.create(`P-ns-${suffix}`);
    await ctx.sessions.create(source.id, "源会话");
    await skills.writeSkillFile(
      "project",
      "solo-skill",
      undefined,
      entry("solo-skill", "只有源项目有"),
      source.id,
    );

    const copy = await ctx.projects.copy(source.id);

    // sessions 不复制（既有不变式）：新项目无会话
    const copySessions = await ctx.sessions.listByProject(copy.id);
    assert.equal(copySessions.length, 0);

    // 技能在新项目、原项目也还在；其他项目（新建第三个项目）不串
    const copyList = await skills.listSkills({ projectId: copy.id });
    assert.ok(copyList.some((s) => s.name === "solo-skill"));
    const sourceList = await skills.listSkills({ projectId: source.id });
    assert.ok(sourceList.some((s) => s.name === "solo-skill"));

    const third = await ctx.projects.create(`P3-${suffix}`);
    const thirdView = await skills.effectiveSkills(third.id);
    assert.equal(
      thirdView.find((s) => s.name === "solo-skill"),
      undefined,
      "项目域技能不应出现在无关项目的合并视图",
    );
  });

  it("delete 项目后负清单行一并清理", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-del-${suffix}`);
    await skills.writeSkillFile(
      "project",
      "doomed-skill",
      undefined,
      entry("doomed-skill", "随项目删除"),
      project.id,
    );
    await skills.setDisabled(project.id, "doomed-skill", true);

    await ctx.projects.delete(project.id);

    const rows = await ctx.conn.query<{ scope_key: string }>(
      "SELECT scope_key FROM skill_disabled_rule WHERE scope_key = ?",
      [`project:${project.id}`],
    );
    assert.equal(rows.length, 0, "项目删除后其负清单行应清理");
  });
});
