import assert from "node:assert";
import {  unwrap  } from "../helpers/result-unwrap.js";
import {  outcomeValue  } from "../helpers/outcome-value.js";
import {  describe, it  } from "node:test";
import {  SkillsServiceFactory  } from "@novel-master/core/skills";
import {  BUILTIN_SKILL_NAMES  } from "../../src/bootstrap/skills/seed-builtin-skills.js";
import {  getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix  } from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("skill 空态", () => {
    it("全新库零技能时 effectiveSkills 返回空数组而非抛错", async () => {
        const ctx = getNovelMasterTestContext();
        const skills = SkillsServiceFactory.create(ctx.conn);
        const project = await ctx.projects.create(`P-empty-${testIsolationSuffix()}`);

        // bootstrap 会幂等种入内置 agent-config（seed-builtin-skills），
        // 「空态」指除内置外无用户技能。
        const globalList = outcomeValue(await skills.listSkills("global"));
        assert.deepEqual(
            globalList.map((s) => s.name).filter((n) => !BUILTIN_SKILL_NAMES.has(n)),
            [],
        );

        const projectList = outcomeValue(await skills.listSkills({ projectId: project.id }));
        assert.deepEqual(projectList, []);

        const view = unwrap(await skills.effectiveSkills(project.id));
        // 未禁用时内置技能计入生效列表（索引可见属预期）；断言仅含内置。
        assert.deepEqual(
            view.filter((s) => !BUILTIN_SKILL_NAMES.has(s.name)).map((s) => s.name),
            [],
        );
    });
});
