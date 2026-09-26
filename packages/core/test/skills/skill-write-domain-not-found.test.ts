/**
 * 写操作（write/edit）域内找不到技能时的报错契约。
 *
 * WHY 这个测试存在：`skill` 工具的 write/edit 缺省 domain=project，而多数技能
 * 只存在于 global 域。此前 editSkillFile 不捕获 VfsError NOT_FOUND，裸 VFS 错误
 * 直接抛给模型——`[NOT_FOUND] Path not found: /meta/skills/助手派遣/SKILL.md`，
 * 既泄漏内部逻辑路径，也没告诉模型该补 `domain:"global"`，模型据此无法自我修复
 * （真实案例：模型收到该错误后直接放弃该子任务且未向用户报告）。
 *
 * 契约：必须是 SkillError(NOT_FOUND)，且文案带命中的域 + 另一域的存在性 + 改参提示。
 *
 * @module test/skills/skill-write-domain-not-found
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSkillsService, isSkillError } from "@novel-master/core/skills";
import type { SkillError } from "@novel-master/core/skills";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function entry(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n正文\n`;
}

/** `assert.rejects` 不回传错误对象，这里自己抓。 */
async function captureError(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (error) {
    assert.ok(
      error instanceof Error,
      `抛出的应是 Error 实例，实际：${String(error)}`
    );
    return error;
  }
  throw new assert.AssertionError({
    message: "预期抛错，但调用成功返回了",
  });
}

function asSkillError(error: Error, context: string): SkillError {
  assert.ok(
    isSkillError(error, "NOT_FOUND"),
    `${context} 应抛 SkillError(NOT_FOUND)，实际：${error.name}: ${error.message}`
  );
  return error as SkillError;
}

describe("写操作域内未找到（回归：skill 工具 edit 报裸 VFS 路径）", () => {
  it("edit 落 project 域、技能只在 global 域：报错指向 domain:\"global\"", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const name = `global-only-${suffix}`;
    const project = await ctx.projects.create(`P-${suffix}`);

    await skills.writeSkillFile("global", name, undefined, entry(name, "全局技能"));

    const raw = await captureError(() =>
      skills.editSkillFile(
        "project",
        name,
        undefined,
        { oldString: "正文", newString: "改写" },
        project.id
      )
    );
    const error = asSkillError(raw, "edit 落 project 域");

    assert.ok(
      !/Path not found/.test(error.message),
      `不应泄漏 VFS 裸路径文案，实际：${error.message}`
    );
    assert.match(error.message, /project/, "文案应说明命中的是 project 域");
    assert.match(
      error.message,
      /domain:"global"/,
      "文案应明确给出可操作参数 domain:\"global\""
    );
  });

  it("edit 落 global 域、技能只在 project 域：报错指向 domain:\"project\"", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const name = `project-only-${suffix}`;
    const project = await ctx.projects.create(`P-${suffix}`);

    await skills.writeSkillFile(
      "project",
      name,
      undefined,
      entry(name, "项目技能"),
      project.id
    );

    // projectId 必须传：skill 工具的 edit/write 恒定透传 ctx.skills.projectId
    const raw = await captureError(() =>
      skills.editSkillFile(
        "global",
        name,
        undefined,
        { oldString: "正文", newString: "改写" },
        project.id
      )
    );
    const error = asSkillError(raw, "edit 落 global 域");

    assert.match(error.message, /domain:"project"/);
  });

  it("edit 落 global 域但无 projectId：明说无法确认 project 域，不谎报「没有」", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const name = `no-projid-${testIsolationSuffix()}`;

    const raw = await captureError(() =>
      skills.editSkillFile(
        "global",
        name,
        undefined,
        { oldString: "正文", newString: "改写" }
      )
    );
    const error = asSkillError(raw, "global 域无 projectId");

    assert.match(error.message, /未能确认 project 域/);
    assert.ok(
      !/domain:"project"/.test(error.message),
      `查不了就不该指示切域，实际：${error.message}`
    );
  });

  it("两域都不存在：给新建提示，不误导去改另一域", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const name = `nowhere-${suffix}`;
    const project = await ctx.projects.create(`P-${suffix}`);

    const raw = await captureError(() =>
      skills.editSkillFile(
        "project",
        name,
        undefined,
        { oldString: "正文", newString: "改写" },
        project.id
      )
    );
    const error = asSkillError(raw, "两域皆无");

    assert.ok(
      !/domain:"global"/.test(error.message),
      `另一域没有该技能时不应提示切域，实际：${error.message}`
    );
    assert.match(error.message, /新建/);
  });

  it("write 落 project 域、技能只在 global 域：在 project 域新建副本，不动 global", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const name = `global-only-w-${suffix}`;
    const project = await ctx.projects.create(`P-${suffix}`);

    await skills.writeSkillFile("global", name, undefined, entry(name, "全局技能"));
    await skills.writeSkillFile("project", name, undefined, "覆盖", project.id);

    // write 语义 = 向新目录写即新建（tools.port 既有约定），不是「找到生效副本改」
    const projectCopy = await skills.readSkillFile(
      "project",
      name,
      undefined,
      project.id
    );
    assert.equal(projectCopy.domain, "project");
    assert.equal(projectCopy.content, "覆盖");

    const global = await skills.readSkillFile("global", name);
    assert.match(global.content, /全局技能/, "global 域本体不应被 write 波及");
  });

  it("显式传对 domain 时 edit 正常成功（防止改坏正向路径）", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const name = `global-ok-${testIsolationSuffix()}`;

    await skills.writeSkillFile("global", name, undefined, entry(name, "全局技能"));

    const result = await skills.editSkillFile(
      "global",
      name,
      undefined,
      { oldString: "正文", newString: "改写后的正文" }
    );

    assert.ok(result.replacements > 0);
    const read = await skills.readSkillFile("global", name);
    assert.match(read.content, /改写后的正文/);
  });

  it("非 NOT_FOUND 的写失败原样透传，不被误转成域错误", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const name = `nomatch-${testIsolationSuffix()}`;

    await skills.writeSkillFile("global", name, undefined, entry(name, "全局技能"));

    // oldString 匹配不到 = VFS 侧的其它错误码，不应被 rethrowWriteNotFound 吞成域错误
    const error = await captureError(() =>
      skills.editSkillFile(
        "global",
        name,
        undefined,
        { oldString: "绝对不存在的匹配串", newString: "x" }
      )
    );

    assert.ok(
      !isSkillError(error, "NOT_FOUND"),
      `匹配失败不应伪装成域内未找到，实际：${error.name}: ${error.message}`
    );
  });
});
