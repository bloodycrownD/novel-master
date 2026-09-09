/**
 * withSkillFrontMatterValues 单测（T-S1）。
 *
 * 语义对齐回收前 desktop skill-zip-import.test.tsx 的既有断言
 * （替换/补全/前置补块），另覆盖单字段提交（编辑信息只改其一）。
 *
 * @module test/skills/with-skill-front-matter-values
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withSkillFrontMatterValues } from "@novel-master/core/skills";

describe("withSkillFrontMatterValues（T-S1）", () => {
  it("替换既有 name/description，保留其余键与正文（含冒号描述转义）", () => {
    const source =
      "---\nname: old-name\ndescription: 旧描述\nextra: 保留\n---\n\n正文。\n";
    const out = withSkillFrontMatterValues(source, {
      name: "new-name",
      description: "含: 冒号的描述",
    });
    assert.match(
      out,
      /^---\nname: "new-name"\ndescription: "含: 冒号的描述"\nextra: 保留\n---\n\n正文。\n$/
    );
  });

  it("块内缺失 name/description 键时补全", () => {
    const source = "---\nname: old\n---\n\n正文。\n";
    const out = withSkillFrontMatterValues(source, {
      name: "old",
      description: "新描述",
    });
    assert.match(out, /name: "old"/);
    assert.match(out, /description: "新描述"/);
  });

  it("无 front matter 块时前置补一个", () => {
    const out = withSkillFrontMatterValues("只有正文。\n", {
      name: "n",
      description: "d",
    });
    assert.match(out, /^---\nname: "n"\ndescription: "d"\n---\n\n只有正文。\n$/);
  });

  it("仅提交 name：description 原样保留", () => {
    const source = "---\nname: old\ndescription: 原描述\n---\n\n正文。\n";
    const out = withSkillFrontMatterValues(source, { name: "renamed" });
    assert.match(out, /^---\nname: "renamed"\ndescription: 原描述\n---\n\n正文。\n$/);
  });

  it("仅提交 description：name 原样保留", () => {
    const source = "---\nname: old\ndescription: 旧描述\n---\n\n正文。\n";
    const out = withSkillFrontMatterValues(source, { description: "新描述" });
    assert.match(
      out,
      /^---\nname: old\ndescription: "新描述"\n---\n\n正文。\n$/
    );
  });

  it("无 front matter 且仅提交单字段：补块只含该字段", () => {
    const out = withSkillFrontMatterValues("正文。\n", { description: "d" });
    assert.match(out, /^---\ndescription: "d"\n---\n\n正文。\n$/);
  });

  it("两字段均缺省：原样返回（防御）", () => {
    const source = "---\nname: old\n---\n\n正文。\n";
    assert.equal(withSkillFrontMatterValues(source, {}), source);
  });
});
