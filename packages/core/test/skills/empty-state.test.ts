import assert from "node:assert";
import { describe, it } from "node:test";
import { createSkillsService } from "@novel-master/core/skills";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("skill 空态", () => {
  it("全新库零技能时 effectiveSkills 返回空数组而非抛错", async () => {
    const ctx = getNovelMasterTestContext();
    const skills = createSkillsService(ctx.conn);
    const project = await ctx.projects.create(`P-empty-${testIsolationSuffix()}`);

    const globalList = await skills.listSkills("global");
    assert.deepEqual(globalList, []);

    const projectList = await skills.listSkills({ projectId: project.id });
    assert.deepEqual(projectList, []);

    const view = await skills.effectiveSkills(project.id);
    assert.deepEqual(view, []);
  });
});
