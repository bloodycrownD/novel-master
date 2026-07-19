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
    assert.equal(uses[0]?.input.command, "rm -r draft.md");
  });

  it("解析 mkdir", () => {
    const uses = actionXmlToToolUses(
      '<action name="mkdir">\n{"path":"notes/"}\n</action>',
    );
    assert.equal(uses[0]?.name, "fs");
    assert.equal(uses[0]?.input.command, "mkdir notes/");
  });

  it("解析 rename", () => {
    const uses = actionXmlToToolUses(
      '<action name="rename">\n{"from":"a.md","to":"b.md"}\n</action>',
    );
    assert.equal(uses[0]?.name, "fs");
    assert.equal(uses[0]?.input.command, "mv a.md b.md");
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
});
