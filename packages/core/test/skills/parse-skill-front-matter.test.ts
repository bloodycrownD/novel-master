/**
 * SKILL.md front matter 解析单测（T-SK4）。
 *
 * @module test/skills/parse-skill-front-matter
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSkillFrontMatter } from "@/domain/skills/logic/parse-skill-front-matter.js";
import { tCore } from "../helpers/core-i18n.js";

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
    assert.match(tCore(parsed.invalidReason!), /不可解析/);
  });

  it("缺少 front matter 时无效", () => {
    const parsed = parseSkillFrontMatter("# 只有正文\n没有 front matter");
    assert.equal(parsed.valid, false);
    assert.match(tCore(parsed.invalidReason!), /缺少 front matter/);
  });

  it("未知键被 strict schema 拒绝（照 agent-definition 模式）", () => {
    const parsed = parseSkillFrontMatter(
      ["---", "name: my-skill", "description: d", "unknown: 1", "---"].join("\n"),
    );
    assert.equal(parsed.valid, false);
    assert.ok(parsed.invalidReason != null);
  });
});

/** 错误用户可见文案：带 messageKey 时经 tCore 渲染（G1-G3 descriptor 契约），否则回退 message。 */
function renderError(error: unknown): string {
  const e = error as {message: string; messageKey?: string; messageParams?: Record<string, unknown>};
  return textOf(error);
}

/** 含 cause 链（ToolError 包装 AppError 时 messageKey 在 cause 上）。 */
function textOf(error: unknown): string {
  const e = error as {message: string; messageKey?: string; messageParams?: Record<string, unknown>; cause?: unknown};
  if (e.messageKey != null) return tCore({key: e.messageKey as never, params: e.messageParams as never});
  if (e.cause != null && typeof e.cause === "object") return textOf(e.cause);
  return e.message;
}
