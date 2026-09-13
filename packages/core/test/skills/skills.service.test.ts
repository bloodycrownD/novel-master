/**
 * SkillService 集成测试（T-SK5）。
 *
 * 覆盖：listSkills 清单与有效性、read 生效副本解析、`..` 路径拒绝、
 * write 缺域报错、SKILL_NAME_PATTERN 校验、edit 局部改、setDisabled /
 * effectiveSkills、deleteSkill 清理负清单。
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

  it("write 对已存在文件：缺省 last-write-wins，版本比对已从底层移除", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const name = `ovw-${testIsolationSuffix()}`;

    await skills.writeSkillFile("global", name, undefined, VALID_SKILL_MD);
    const read = await skills.readSkillFile("global", name);

    // 不带版本（skill 工具的 LLM 路径）：直接覆盖成功，不再要求先 read 拿版本
    const blind = await skills.writeSkillFile(
      "global",
      name,
      undefined,
      "# 盲写",
    );
    assert.ok(blind.version > read.version, "盲写覆盖后版本应递增");

    // 多轮覆盖：每轮版本递增，无 CONFLICT
    const again = await skills.writeSkillFile(
      "global",
      name,
      undefined,
      "# 再写",
    );
    assert.ok(again.version > blind.version, "二次覆盖版本应递增");

    const fresh = await skills.readSkillFile("global", name);
    assert.equal(fresh.content, "# 再写");
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
    // 只有辅助文件、没有 SKILL.md 的技能目录（技能落 meta 域）
    await ctx.globalMetaVfs().write(
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
      () => ctx.globalMetaVfs().read("/meta/skills/victim.md"),
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

  it("deleteSkill global 域内置名抛 BUILTIN_SKILL（中文 message）且目录仍在（T-AS2）", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);

    // 测试库经 bootstrap 种入，global 域 agent-config 目录存在
    await assert.rejects(
      () => skills.deleteSkill({ domain: "global", name: "agent-config" }),
      (error: unknown) =>
        error instanceof SkillError &&
        error.code === "BUILTIN_SKILL" &&
        /内置技能不支持删除：agent-config/.test(error.message),
    );

    // 拦截后技能目录仍在，清单还能查到
    const item = (await skills.listSkills("global")).find(
      (s) => s.name === "agent-config",
    );
    assert.ok(item != null, "内置技能目录应仍在");
    assert.equal(item.valid, true);
  });

  it("deleteSkill project 域历史同名副本可正常删（T-AS2）", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-AC-${suffix}`);

    // 升级前建的 project 域同名副本：writeSkillFile 的新建拦截会挡住正常通道，
    // 存量数据只能经 VFS 直写落盘（模拟）
    await ctx
      .projectMetaVfs(project.id)
      .write("/meta/skills/agent-config/SKILL.md", entry("agent-config", "项目域历史副本"));

    await skills.deleteSkill({
      domain: "project",
      projectId: project.id,
      name: "agent-config",
    });

    const list = await skills.listSkills({ projectId: project.id });
    assert.equal(
      list.find((s) => s.name === "agent-config"),
      undefined,
      "project 域同名副本应可正常删除",
    );
  });

  it("writeSkillFile 内置保留名：目录已存在编辑放行，目录不存在新建拒绝（T-AS6）", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-ACR-${suffix}`);

    // global 域目录已存在（bootstrap 种入）：编辑放行。writeSkillFile
    // 无版本校验，固定 last-write-wins：写入内容直接覆盖现有文件。
    // 这里用辅助文件覆盖放行路径
    await skills.writeSkillFile(
      "global",
      "agent-config",
      "notes.md",
      "内置技能的辅助文件",
    );
    const note = await skills.readSkillFile("global", "agent-config", "notes.md");
    assert.equal(note.content, "内置技能的辅助文件");

    const edit = await skills.editSkillFile(
      "global",
      "agent-config",
      undefined,
      { oldString: "agent 配置指南", newString: "用户改过的指南" },
    );
    assert.equal(edit.replacements, 1, "内置本体编辑应放行");

    // project 域目录不存在 = 新建，拒绝（中文 message）
    await assert.rejects(
      () =>
        skills.writeSkillFile(
          "project",
          "agent-config",
          undefined,
          VALID_SKILL_MD,
          project.id,
        ),
      (error: unknown) =>
        error instanceof SkillError &&
        error.code === "BUILTIN_SKILL_NAME_RESERVED" &&
        /「agent-config」为内置技能保留名，不能用于新建/.test(error.message),
    );

    // global 域模拟 seed 缺失：物理清掉内置目录后，新建同样拒绝
    await ctx
      .globalMetaVfs()
      .hardDelete("/meta/skills/agent-config", { recursive: true });
    await assert.rejects(
      () =>
        skills.writeSkillFile("global", "agent-config", undefined, VALID_SKILL_MD),
      (error: unknown) =>
        error instanceof SkillError &&
        error.code === "BUILTIN_SKILL_NAME_RESERVED",
    );

    // 恢复内置目录（builtinSeed 豁免重种）：同文件后续用例
    //（updateSkillInfo ④⑤⑨ 等）依赖 agent-config 目录存在，
    // 避免用例间顺序耦合。
    await skills.writeSkillFile(
      "global",
      "agent-config",
      undefined,
      entry("agent-config", "agent 定义配置指南（测试重种）"),
      undefined,
      { builtinSeed: true },
    );
  });

  it("assertSkillNameNotReservedForCreate：ZIP 新建通道的保留名门（D-1）", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-D1-${suffix}`);

    // 非名单名：任意域直接放行（不抛）
    await skills.assertSkillNameNotReservedForCreate(
      "project",
      `plain-${suffix}`,
      project.id,
    );
    await skills.assertSkillNameNotReservedForCreate("global", `plain-${suffix}`);

    // 名单内 + project 域目录不存在（= 新建，ZIP 导入场景）拒绝，中文 message
    await assert.rejects(
      () =>
        skills.assertSkillNameNotReservedForCreate(
          "project",
          "agent-config",
          project.id,
        ),
      (error: unknown) =>
        error instanceof SkillError &&
        error.code === "BUILTIN_SKILL_NAME_RESERVED" &&
        /「agent-config」为内置技能保留名，不能用于新建/.test(error.message),
    );

    // project 域缺 projectId：与 writeSkillFile 的 vfsForDomain 校验同源拒绝
    await assert.rejects(
      () => skills.assertSkillNameNotReservedForCreate("project", "agent-config"),
      (error: unknown) =>
        error instanceof SkillError && error.code === "MISSING_PROJECT_ID",
    );

    // builtinSeed 豁免仍仅 seed 通道有效：新入口无豁免参数（同一目录不存在
    // 场景恒拒绝）；writeSkillFile 带 builtinSeed 写入后目录已存在，新入口
    // 转为放行（编辑语义）。用例自建目录，不依赖其他用例的 global 域残留。
    await skills.writeSkillFile(
      "project",
      "agent-config",
      undefined,
      VALID_SKILL_MD,
      project.id,
      { builtinSeed: true },
    );
    await skills.assertSkillNameNotReservedForCreate(
      "project",
      "agent-config",
      project.id,
    );
  });

  describe("updateSkillInfo（T-S2 / T-S3）", () => {
    it("① 正常改名：目录迁移 + front matter name 同步 + $新名可解析（T-S3 revision 跟随）", async () => {
      const ctx = getNovelMasterTestContext();
      const skills = createSkillsService(ctx.conn);
      const suffix = testIsolationSuffix();
      const oldName = `ren-old-${suffix}`;
      const newName = `ren-new-${suffix}`;

      await skills.writeSkillFile(
        "global",
        oldName,
        undefined,
        entry(oldName, "改名前描述"),
      );
      const before = await skills.readSkillFile("global", oldName);

      await skills.updateSkillInfo(
        { domain: "global", name: oldName },
        { newName },
      );

      // 旧路径不可读，新路径可读且 front matter name 同步
      await assert.rejects(
        () => skills.readSkillFile("global", oldName),
        (error: unknown) =>
          error instanceof SkillError && error.code === "NOT_FOUND",
      );
      const after = await skills.readSkillFile("global", newName);
      assert.match(after.content, /name: "ren-new-[^\"]*"/);
      // T-S3：同 entry 的 version 连续（renamePrefix 不重置，front matter
      // 重写 bump 一次）
      assert.ok(
        after.version > before.version,
        "改名后新路径 version 应高于改名前（revision 历史跟随）",
      );

      // 清单在新名下仍有效；$新名 进入合并视图
      const list = await skills.listSkills("global");
      const item = list.find((s) => s.name === newName);
      assert.ok(item != null && item.valid, "新名应出现在清单且有效");
      assert.equal(
        list.find((s) => s.name === oldName),
        undefined,
        "旧名不应再出现在清单",
      );
      const project = await ctx.projects.create(`P-REN-${suffix}`);
      const view = await skills.effectiveSkills(project.id);
      assert.ok(
        view.find((s) => s.name === newName) != null,
        "$新名应可解析（合并视图）",
      );
    });

    it("② 启停状态保留：改名前禁用，负清单行跟随新名", async () => {
      const ctx = getNovelMasterTestContext();
      const skills = createSkillsService(ctx.conn);
      const suffix = testIsolationSuffix();
      const project = await ctx.projects.create(`P-DIS-${suffix}`);
      const oldName = `dis-old-${suffix}`;
      const newName = `dis-new-${suffix}`;

      await skills.writeSkillFile(
        "global",
        oldName,
        undefined,
        entry(oldName, "禁用迁移"),
      );
      await skills.setDisabled(project.id, oldName, true);

      await skills.updateSkillInfo(
        { domain: "global", name: oldName },
        { newName },
      );

      // 直查负清单表：行已迁移为新名（deleteSkill 用例的先例口径）
      const rows = await ctx.conn.query<{ skill_name: string }>(
        "SELECT skill_name FROM skill_disabled_rule WHERE skill_name = ?",
        [newName],
      );
      assert.equal(rows.length, 1, "负清单行应已迁移到新名");
      const oldRows = await ctx.conn.query<{ skill_name: string }>(
        "SELECT skill_name FROM skill_disabled_rule WHERE skill_name = ?",
        [oldName],
      );
      assert.equal(oldRows.length, 0, "旧名负清单行不应残留");

      // 合并视图：新名处于禁用态
      const view = await skills.effectiveSkills(project.id);
      const moved = view.find((s) => s.name === newName);
      assert.ok(moved != null);
      assert.equal(moved.disabled, true, "改名后禁用状态应保留");
    });

    it("③ 域内查重撞名：SKILL_ALREADY_EXISTS（错误码还原不丢）", async () => {
      const ctx = getNovelMasterTestContext();
      const skills = createSkillsService(ctx.conn);
      const suffix = testIsolationSuffix();
      const victim = `dup-${suffix}`;

      await skills.writeSkillFile(
        "global",
        victim,
        undefined,
        entry(victim, "占位技能"),
      );
      await skills.writeSkillFile(
        "global",
        `src-${suffix}`,
        undefined,
        entry(`src-${suffix}`, "改名源"),
      );

      // 撞名拒绝；错误经事务包装后解包还原（消息含目标名）
      await assert.rejects(
        () =>
          skills.updateSkillInfo(
            { domain: "global", name: `src-${suffix}` },
            { newName: victim },
          ),
        (error: unknown) =>
          error instanceof SkillError &&
          error.code === "SKILL_ALREADY_EXISTS" &&
          /已存在同名技能/.test(error.message),
      );
      // 拒绝后源技能原样（未半迁移）
      const list = await skills.listSkills("global");
      assert.ok(list.find((s) => s.name === `src-${suffix}`) != null);
      assert.ok(list.find((s) => s.name === victim) != null);
    });

    it("④ global 域内置技能改名拒：BUILTIN_SKILL_RENAME（中文文案）", async () => {
      const ctx = getNovelMasterTestContext();
      const skills = createSkillsService(ctx.conn);

      await assert.rejects(
        () =>
          skills.updateSkillInfo(
            { domain: "global", name: "agent-config" },
            { newName: `agent-renamed-${testIsolationSuffix()}` },
          ),
        (error: unknown) =>
          error instanceof SkillError &&
          error.code === "BUILTIN_SKILL_RENAME" &&
          /内置技能不支持重命名：agent-config/.test(error.message),
      );

      // 拒绝后内置技能目录原样
      const item = (await skills.listSkills("global")).find(
        (s) => s.name === "agent-config",
      );
      assert.ok(item != null, "内置技能目录应仍在");
    });

    it("⑤ 目标名撞内置保留名拒：BUILTIN_SKILL_NAME_RESERVED", async () => {
      const ctx = getNovelMasterTestContext();
      const skills = createSkillsService(ctx.conn);
      const suffix = testIsolationSuffix();
      const src = `to-builtin-${suffix}`;

      await skills.writeSkillFile(
        "global",
        src,
        undefined,
        entry(src, "想改成内置名"),
      );

      // 目标名 agent-config 在 global 域目录已存在（本体），先过保留名门
      //（目录存在放行）再被域内查重拦下；project 域目录不存在则直接被
      // 保留名门拒——两条路径都要验证
      await assert.rejects(
        () =>
          skills.updateSkillInfo(
            { domain: "global", name: src },
            { newName: "agent-config" },
          ),
        (error: unknown) =>
          error instanceof SkillError &&
          (error.code === "BUILTIN_SKILL_NAME_RESERVED" ||
            error.code === "SKILL_ALREADY_EXISTS"),
      );

      const project = await ctx.projects.create(`P-TB-${suffix}`);
      await assert.rejects(
        () =>
          skills.updateSkillInfo(
            { domain: "project", projectId: project.id, name: src },
            { newName: "agent-config" },
          ),
        (error: unknown) =>
          error instanceof SkillError &&
          // 保留名门先于源目录存在性检查：project 域目标目录不存在
          //（= 新建语义）直接拒，不会走到 NOT_FOUND
          error.code === "BUILTIN_SKILL_NAME_RESERVED",
      );

      // project 域真实存在的技能改名为内置名：目录不存在 → 保留名门拒
      await skills.writeSkillFile(
        "project",
        src,
        undefined,
        entry(src, "项目域源"),
        project.id,
      );
      await assert.rejects(
        () =>
          skills.updateSkillInfo(
            { domain: "project", projectId: project.id, name: src },
            { newName: "agent-config" },
          ),
        (error: unknown) =>
          error instanceof SkillError &&
          error.code === "BUILTIN_SKILL_NAME_RESERVED",
      );
    });

    it("⑥ global 域改名：负清单全 scope 迁移（镜像 deleteSkill 连带口径）", async () => {
      const ctx = getNovelMasterTestContext();
      const skills = createSkillsService(ctx.conn);
      const suffix = testIsolationSuffix();
      const p1 = await ctx.projects.create(`PG1-${suffix}`);
      const p2 = await ctx.projects.create(`PG2-${suffix}`);
      const oldName = `gs-old-${suffix}`;
      const newName = `gs-new-${suffix}`;

      await skills.writeSkillFile(
        "global",
        oldName,
        undefined,
        entry(oldName, "全局迁移"),
      );
      await skills.setDisabled(p1.id, oldName, true);
      await skills.setDisabled(p2.id, oldName, true);

      await skills.updateSkillInfo(
        { domain: "global", name: oldName },
        { newName },
      );

      // 两个项目的负清单行全部迁移到新名
      const rows = await ctx.conn.query<{ scope_key: string }>(
        "SELECT scope_key FROM skill_disabled_rule WHERE skill_name = ?",
        [newName],
      );
      assert.equal(rows.length, 2, "全 scope 负清单行都应迁移到新名");
      const oldRows = await ctx.conn.query<{ scope_key: string }>(
        "SELECT scope_key FROM skill_disabled_rule WHERE skill_name = ?",
        [oldName],
      );
      assert.equal(oldRows.length, 0, "旧名行不应残留");
    });

    it("⑦ invalid 技能改名：目录与负清单迁移、front matter 不动（仍 invalid）", async () => {
      const ctx = getNovelMasterTestContext();
      const skills = createSkillsService(ctx.conn);
      const suffix = testIsolationSuffix();
      const project = await ctx.projects.create(`P-INV-${suffix}`);
      const oldName = `inv-old-${suffix}`;
      const newName = `inv-new-${suffix}`;

      // 无 front matter 的 SKILL.md = invalid（front matter 不可解析）
      await skills.writeSkillFile(
        "global",
        oldName,
        undefined,
        "没有 front matter 的正文\n",
      );
      await skills.setDisabled(project.id, oldName, true);

      await skills.updateSkillInfo(
        { domain: "global", name: oldName },
        { newName, description: "顺手提交的描述" },
      );

      // 目录迁移了，但正文原样（未被补块/改写），仍 invalid
      const read = await skills.readSkillFile("global", newName);
      assert.equal(read.content, "没有 front matter 的正文\n");
      const item = (await skills.listSkills("global")).find(
        (s) => s.name === newName,
      );
      assert.ok(item != null && item.valid === false, "invalid 技能改名后应仍 invalid");
      // 负清单行已迁移
      const rows = await ctx.conn.query<{ skill_name: string }>(
        "SELECT skill_name FROM skill_disabled_rule WHERE skill_name = ?",
        [newName],
      );
      assert.equal(rows.length, 1);
    });

    it("⑧ 仅改描述：无目录迁移、description 更新、revision 递增", async () => {
      const ctx = getNovelMasterTestContext();
      const skills = createSkillsService(ctx.conn);
      const suffix = testIsolationSuffix();
      const name = `desc-only-${suffix}`;

      await skills.writeSkillFile(
        "global",
        name,
        undefined,
        entry(name, "旧描述"),
      );
      const before = await skills.readSkillFile("global", name);

      await skills.updateSkillInfo(
        { domain: "global", name },
        { description: "仅改描述的新文案" },
      );

      const after = await skills.readSkillFile("global", name);
      assert.equal(after.name, name, "目录不应迁移");
      assert.ok(after.version > before.version, "改描述应 bump version（revision 记录）");
      const item = (await skills.listSkills("global")).find(
        (s) => s.name === name,
      );
      assert.ok(item != null);
      assert.equal(item.description, "仅改描述的新文案");
      assert.match(after.content, /正文/);
    });

    it("⑨ global 域 builtin 仅改描述：放行且只重写 front matter（防步骤②误拦回归）", async () => {
      const ctx = getNovelMasterTestContext();
      const skills = createSkillsService(ctx.conn);

      const before = await skills.readSkillFile("global", "agent-config");
      const newDescription = `内置技能描述更新-${testIsolationSuffix()}`;

      await skills.updateSkillInfo(
        { domain: "global", name: "agent-config" },
        { description: newDescription },
      );

      const after = await skills.readSkillFile("global", "agent-config");
      assert.ok(after.version > before.version, "仅改描述应产生新 revision");
      const item = (await skills.listSkills("global")).find(
        (s) => s.name === "agent-config",
      );
      assert.ok(item != null && item.valid, "内置技能改描述后应仍有效");
      assert.equal(item.description, newDescription);
    });
  });
});
