/**
 * 技能名校验（SKILL_NAME_PATTERN）单测。
 *
 * @module test/skills/skill-name
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SKILL_NAME_PATTERN,
  SKILL_NAME_PATTERN_SOURCE,
  isValidSkillName,
  validateSkillName,
} from "@/domain/skills/model/skill-name.js";

describe("SKILL_NAME_PATTERN 校验", () => {
  it("合法名通过：字母 / 数字 / 连字符 / 下划线 / 中文 / 中间点", () => {
    for (const name of [
      "my-skill",
      "my_skill",
      "skill2",
      "写作助手",
      "a.b",
      "v1.2-final",
      "技能-中文",
    ]) {
      assert.equal(validateSkillName(name), null, `${name} 应合法`);
      assert.ok(SKILL_NAME_PATTERN.test(name));
      assert.ok(isValidSkillName(name));
    }
  });

  it("含空白或 / 的名字被拒绝", () => {
    for (const name of ["my skill", "my\tskill", "my/skill", "a\nb", " "]) {
      assert.ok(validateSkillName(name) != null, `${JSON.stringify(name)} 应非法`);
      assert.ok(!isValidSkillName(name));
    }
  });

  it("以 . 开头的名字被拒绝", () => {
    assert.ok(validateSkillName(".hidden") != null);
    assert.ok(!SKILL_NAME_PATTERN.test(".hidden"));
    assert.ok(validateSkillName("..") != null);
  });

  it("保留名 SKILL.md 大小写不敏感被拒绝", () => {
    for (const name of ["SKILL.md", "skill.md", "Skill.MD", "skill.Md"]) {
      const reason = validateSkillName(name);
      assert.ok(reason != null, `${name} 应非法`);
      assert.match(reason!, /保留名/);
    }
  });

  it("空名被拒绝", () => {
    assert.ok(validateSkillName("") != null);
  });

  it("SKILL_NAME_PATTERN_SOURCE 可组合（$ token 捕获形态）", () => {
    const tokenRe = new RegExp(`^(\\$)(${SKILL_NAME_PATTERN_SOURCE})$`);
    const m = tokenRe.exec("$my-skill");
    assert.ok(m);
    assert.equal(m[2], "my-skill");
    // 前导 . 不会被捕获为合法 token 名
    assert.ok(!tokenRe.test("$.hidden"));
    assert.ok(!tokenRe.test("$a b"));
  });
});
