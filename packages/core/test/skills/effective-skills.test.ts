/**
 * 技能合并视图纯函数单测（T-SK4）：global ∪ project、同名覆盖、禁用过滤、无效保留。
 *
 * @module test/skills/effective-skills
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeEffectiveSkills } from "@/domain/skills/logic/effective-skills.js";
import type { SkillSummary } from "@/domain/skills/model/skill.schema.js";

function skill(
  name: string,
  domain: "global" | "project",
  overrides: Partial<SkillSummary> = {},
): SkillSummary {
  return {
    name,
    description: `${name}-desc`,
    domain,
    valid: true,
    ...overrides,
  };
}

describe("computeEffectiveSkills（T-SK4）", () => {
  it("global ∪ project 合并，按名称排序", () => {
    const result = computeEffectiveSkills({
      global: [skill("alpha", "global"), skill("gamma", "global")],
      project: [skill("beta", "project")],
    });
    assert.deepEqual(
      result.map((s) => s.name),
      ["alpha", "beta", "gamma"],
    );
    assert.deepEqual(
      result.map((s) => s.domain),
      ["global", "project", "global"],
    );
    assert.ok(result.every((s) => s.effective));
    assert.ok(result.every((s) => !s.overridden && !s.disabled));
  });

  it("同名时 project 副本覆盖 global 版并标 overridden，global 原件不出现", () => {
    const result = computeEffectiveSkills({
      global: [skill("helper", "global", { description: "global 版" })],
      project: [skill("helper", "project", { description: "project 版" })],
    });
    assert.equal(result.length, 1);
    assert.equal(result[0]!.domain, "project");
    assert.equal(result[0]!.description, "project 版");
    assert.equal(result[0]!.overridden, true);
  });

  it("负清单过滤：禁用技能保留但不计入生效", () => {
    const result = computeEffectiveSkills({
      global: [skill("alpha", "global"), skill("beta", "global")],
      project: [],
      disabledNames: ["alpha"],
    });
    const alpha = result.find((s) => s.name === "alpha")!;
    assert.equal(alpha.disabled, true);
    assert.equal(alpha.effective, false, "禁用技能不计入生效");
    assert.equal(alpha.valid, true, "禁用不影响有效性");
    const beta = result.find((s) => s.name === "beta")!;
    assert.equal(beta.disabled, false);
    assert.equal(beta.effective, true);
  });

  it("同名覆盖时禁用按名字命中（覆盖后的副本为准）", () => {
    const result = computeEffectiveSkills({
      global: [skill("helper", "global")],
      project: [skill("helper", "project")],
      disabledNames: new Set(["helper"]),
    });
    const helper = result.find((s) => s.name === "helper")!;
    assert.equal(helper.domain, "project");
    assert.equal(helper.overridden, true);
    assert.equal(helper.disabled, true);
    assert.equal(helper.effective, false);
  });

  it("无效技能保留并标 invalid，不计入生效", () => {
    const result = computeEffectiveSkills({
      global: [
        skill("broken", "global", {
          valid: false,
          invalidReason: "缺少 front matter",
          description: null,
        }),
      ],
      project: [],
    });
    assert.equal(result.length, 1, "无效技能应保留在清单");
    const broken = result[0]!;
    assert.equal(broken.valid, false);
    assert.equal(broken.invalidReason, "缺少 front matter");
    assert.equal(broken.effective, false, "无效技能不计入生效");
  });

  it("无效技能的同名 project 副本有效时按副本生效", () => {
    const result = computeEffectiveSkills({
      global: [
        skill("helper", "global", { valid: false, invalidReason: "YAML 坏了" }),
      ],
      project: [skill("helper", "project")],
    });
    const helper = result.find((s) => s.name === "helper")!;
    assert.equal(helper.domain, "project");
    assert.equal(helper.valid, true);
    assert.equal(helper.effective, true);
  });

  it("空输入返回空数组", () => {
    assert.deepEqual(computeEffectiveSkills({ global: [], project: [] }), []);
  });
});
