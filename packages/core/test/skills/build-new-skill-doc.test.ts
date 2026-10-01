/**
 * buildNewSkillDoc 单源单测（wave-e H3）。
 *
 * 锁的是「新建模板的 front matter 必须经 yamlScalar 转义」这条单源口径：
 * 回收前 desktop 端裸插值，description 里出现**半角** `": "` 时
 * `parseSkillFrontMatter` 判 invalid ⇒ 技能一建出来就显示「无效技能」。
 *
 * ⚠️ 断言输入必须是**半角**冒号 + 后跟空格：全角 `：` 在有 bug 的裸插值实现上
 * 同样 valid===true，拿全角写这条用例就没有牙齿（wave-e MF-12 实测）。
 *
 * @module test/skills/build-new-skill-doc
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNewSkillDoc,
  parseSkillFrontMatter,
} from "@novel-master/core/skills";

describe("buildNewSkillDoc（wave-e H3）", () => {
  it("description 含半角冒号时产出的 front matter 可被 parseSkillFrontMatter 解析", () => {
    const doc = buildNewSkillDoc("s", "用途: 调研");
    const parsed = parseSkillFrontMatter(doc);
    assert.equal(parsed.valid, true, parsed.valid ? "" : parsed.invalidReason);
    assert.equal(parsed.name, "s");
    assert.equal(parsed.description, "用途: 调研");
  });

  it("description 含引号/换行/井号时同样可解析", () => {
    for (const description of ['He said "hi"', "第一行\n第二行", "#h 不是标题", "- 不是序列项"]) {
      const doc = buildNewSkillDoc("s", description);
      const parsed = parseSkillFrontMatter(doc);
      assert.equal(
        parsed.valid,
        true,
        `description=${JSON.stringify(description)} ⇒ ${parsed.valid ? "" : parsed.invalidReason}`,
      );
      assert.equal(parsed.description, description);
    }
  });

  it("name 含半角冒号时同样可解析", () => {
    const doc = buildNewSkillDoc("ns: v2", "普通描述");
    const parsed = parseSkillFrontMatter(doc);
    assert.equal(parsed.valid, true, parsed.valid ? "" : parsed.invalidReason);
    assert.equal(parsed.name, "ns: v2");
  });

  it("产出结构仍是 front matter + 标题 + 引导说明（锁模板形态）", () => {
    const lines = buildNewSkillDoc("s", "d").split("\n");
    assert.equal(lines[0], "---");
    assert.equal(lines[1], 'name: "s"');
    assert.equal(lines[2], 'description: "d"');
    assert.equal(lines[3], "---");
    assert.equal(lines[4], "");
    assert.equal(lines[5], "# s");
  });

  it("两个正文变体的 front matter 完全一致，只有引导说明段不同", () => {
    const desktop = buildNewSkillDoc("s", "d", "desktop");
    const mobile = buildNewSkillDoc("s", "d", "mobile");
    const head = (doc: string) => doc.split("\n").slice(0, 4).join("\n");
    assert.equal(head(desktop), head(mobile));
    assert.notEqual(desktop, mobile);
    assert.match(desktop, /<!-- 在这里编写技能说明/);
    assert.match(mobile, /## 使用说明/);
  });
});