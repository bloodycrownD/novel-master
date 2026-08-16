/**
 * SKILL.md front matter 解析单测（T-SK4）。
 *
 * @module test/skills/parse-skill-front-matter
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSkillFrontMatter } from "@/domain/skills/logic/parse-skill-front-matter.js";

describe("parseSkillFrontMatter（T-SK4）", () => {
  it("合法 front matter：name 与 description 齐全时有效", () => {
    const source = `---
name: my-skill
description: 一个写作辅助技能
---

# 正文

技能指令……`;
    const parsed = parseSkillFrontMatter(source);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.name, "my-skill");
    assert.equal(parsed.description, "一个写作辅助技能");
    assert.equal(parsed.invalidReason, undefined);
  });

  it("缺 name 时无效并给出原因", () => {
    const parsed = parseSkillFrontMatter(
      ["---", "description: 只有描述", "---", "", "正文"].join("\n"),
    );
    assert.equal(parsed.valid, false);
    assert.ok(parsed.invalidReason != null);
    assert.equal(parsed.description, "只有描述");
  });

  it("缺 description 时无效并给出原因（name 仍尽力提取）", () => {
    const parsed = parseSkillFrontMatter(
      ["---", "name: my-skill", "---", "", "正文"].join("\n"),
    );
    assert.equal(parsed.valid, false);
    assert.ok(parsed.invalidReason != null);
    assert.equal(parsed.name, "my-skill");
    assert.equal(parsed.description, null);
  });

  it("name / description 为空串时无效", () => {
    for (const field of ["name", "description"]) {
      const lines = [
        "---",
        "name: my-skill",
        "description: desc",
        "---",
      ].map((l) => (l.startsWith(`${field}:`) ? `${field}: ""` : l));
      const parsed = parseSkillFrontMatter(lines.join("\n"));
      assert.equal(parsed.valid, false, `${field} 为空串应无效`);
    }
  });

  it("YAML 不可解析时无效", () => {
    const parsed = parseSkillFrontMatter(
      ["---", "name: [unclosed", "---", "", "正文"].join("\n"),
    );
    assert.equal(parsed.valid, false);
    assert.match(parsed.invalidReason ?? "", /不可解析/);
  });

  it("缺少 front matter 时无效", () => {
    const parsed = parseSkillFrontMatter("# 只有正文\n没有 front matter");
    assert.equal(parsed.valid, false);
    assert.match(parsed.invalidReason ?? "", /缺少 front matter/);
  });

  it("未知键被 strict schema 拒绝（照 agent-definition 模式）", () => {
    const parsed = parseSkillFrontMatter(
      ["---", "name: my-skill", "description: d", "unknown: 1", "---"].join("\n"),
    );
    assert.equal(parsed.valid, false);
    assert.ok(parsed.invalidReason != null);
  });
});
