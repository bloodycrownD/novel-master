/**
 * action-xml-to-tool-uses 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionXmlToToolUses } from "../../src/domain/vfs/logic/action-xml-to-tool-uses.js";

describe("actionXmlToToolUses", () => {
  it("解析 delete", () => {
    const uses = actionXmlToToolUses(
      '<action name="delete">\n{\n  "path": "draft.md",\n  "recursive": true\n}\n</action>',
    );
    assert.equal(uses.length, 1);
    assert.equal(uses[0]?.name, "fs");
    assert.deepEqual(uses[0]?.input, { action: "rm", path: "draft.md", recursive: true });
  });

  it("解析 mkdir", () => {
    const uses = actionXmlToToolUses(
      '<action name="mkdir">\n{"path":"notes/"}\n</action>',
    );
    assert.equal(uses[0]?.name, "fs");
    assert.deepEqual(uses[0]?.input, { action: "mkdir", path: "notes/" });
  });

  it("解析 rename（同目录）与 move（跨目录）均 → mv", () => {
    const renameUses = actionXmlToToolUses(
      '<action name="rename">\n{"from":"a.md","to":"b.md"}\n</action>',
    );
    assert.equal(renameUses[0]?.name, "fs");
    assert.deepEqual(renameUses[0]?.input, { action: "mv", from: "a.md", to: "b.md" });

    const moveUses = actionXmlToToolUses(
      '<action name="move">\n{"from":"/a.md","to":"/dir/b.md"}\n</action>',
    );
    assert.equal(moveUses[0]?.name, "fs");
    assert.deepEqual(moveUses[0]?.input, { action: "mv", from: "/a.md", to: "/dir/b.md" });
  });

  it("解析 edit", () => {
    const xml =
      '<action name="edit">\n' +
      '{\n  "path": "ch.md",\n  "oldString": "old",\n  "newString": "new"\n}\n' +
      "</action>";
    const uses = actionXmlToToolUses(xml);
    assert.equal(uses.length, 1);
    assert.equal(uses[0]?.name, "edit");
    assert.equal(uses[0]?.input.path, "ch.md");
    assert.equal(uses[0]?.input.oldString, "old");
    assert.equal(uses[0]?.input.newString, "new");
  });

  it("解析 write（含正文）", () => {
    const uses = actionXmlToToolUses(
      '<action name="write">\n' +
        '{\n  "path": "ch.md",\n  "content": "hello & world"\n}\n' +
        "</action>",
    );
    assert.equal(uses[0]?.name, "write");
    assert.equal(uses[0]?.input.path, "ch.md");
    assert.equal(uses[0]?.input.content, "hello & world");
  });

  it("解析空 content 的 write", () => {
    const uses = actionXmlToToolUses(
      '<action name="write">\n{"path":"ch.md","content":""}\n</action>',
    );
    assert.equal(uses[0]?.name, "write");
    assert.equal(uses[0]?.input.content, "");
  });

  it("解析 write 时反转义 HTML 中文引号 entity（&ldquo; &rdquo;）", () => {
    // LLM 偷懒用 &ldquo; 代替“，如果 unescapeXml 不处理就会原样进 vfs，
    // edit 时跟文件里的“对不上，导致 REPLACE_NOT_FOUND。
    const uses = actionXmlToToolUses(
      '<action name="write">\n' +
        '{\n  "path": "ch.md",\n  "content": "&ldquo;你好&rdquo; &lsquo;世界&rsquo; &hellip; &mdash; &ndash; &nbsp;end"\n}\n' +
        "</action>",
    );
    assert.equal(uses[0]?.input.content, "“你好” ‘世界’ … — – \u00a0end");
  });

  it("解析 edit 时 HTML entity 与 XML entity 同时出现都能反转义", () => {
    // HTML 中文引号、省略号 + XML 的 &lt; &gt; &amp; 混在一起。
    // 注意：JSON body 里的 " 由 JSON 自己用 \" 转义，不走 &quot;，
    // 所以这里不测 &quot;，避免被误导。
    const uses = actionXmlToToolUses(
      '<action name="edit">\n' +
        '{\n  "path": "ch.md",\n  "oldString": "&ldquo;a&lt;b&amp;c&rdquo; &hellip;",\n  "newString": "x"\n}\n' +
        "</action>",
    );
    assert.equal(uses[0]?.input.oldString, "“a<b&c” …");
  });
});
