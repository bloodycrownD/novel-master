/**
 * user-vfs-save-mapping 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UserVfsSaveMapping } from "../../src/domain/vfs/logic/user-vfs-save-mapping.js";

describe("UserVfsSaveMapping.mapToToolUses", () => {
  it("内容相等时返回 noop", () => {
    const result = UserVfsSaveMapping.mapToToolUses("hello", "hello", "a.md", "hello");
    assert.equal(result.kind, "noop");
  });

  it("新文件返回 write", () => {
    const result = UserVfsSaveMapping.mapToToolUses(null, "new", "new.md", "new");
    assert.equal(result.kind, "write");
    if (result.kind === "write") {
      assert.equal(result.path, "new.md");
      assert.equal(result.content, "new");
      assert.equal(result.reason, "new-file");
    }
  });

  it("小改锚点 edit", () => {
    const baseline = "line1\nline2\nline3";
    const saved = "line1\nLINE2\nline3";
    const result = UserVfsSaveMapping.mapToToolUses(baseline, saved, "ch.md", saved);
    assert.equal(result.kind, "edit");
    if (result.kind === "edit") {
      assert.equal(result.toolUses.length, 1);
      assert.equal(result.toolUses[0]?.name, "edit");
      assert.equal(result.toolUses[0]?.input.path, "ch.md");
      assert.equal(result.editHunks.length, 1);
    }
  });

  it("锚点不唯一时 fallback write", () => {
    const baseline = "aa\naa";
    const saved = "AA\naa";
    const result = UserVfsSaveMapping.mapToToolUses(baseline, saved, "x.md", saved);
    assert.equal(result.kind, "write");
    if (result.kind === "write") {
      assert.equal(result.reason, "anchor-not-unique");
    }
  });

  it("多 hunk 生成多个 edit tool_use", () => {
    const baseline = "aaa\nsep\nbbb\nsep\nccc";
    const saved = "AAA\nsep\nbbb\nsep\nCCC";
    const result = UserVfsSaveMapping.mapToToolUses(baseline, saved, "multi.md", saved);
    assert.equal(result.kind, "edit");
    if (result.kind === "edit") {
      assert.equal(result.toolUses.length, 2);
      assert.equal(result.editHunks.length, 2);
    }
  });
});

describe("buildUserVfsSaveActionXml", () => {
  it("生成 edit action XML", () => {
    const xml = UserVfsSaveMapping.buildEditActionXml("a.md", [
      { index: 1, oldString: "old", newString: "new" },
    ]);
    assert.ok(xml.includes('<action name="edit">'));
    assert.ok(xml.includes('"oldString": "old"'));
    assert.ok(xml.includes('"newString": "new"'));
  });

  it("生成 write action XML（JSON 正文）", () => {
    const xml = UserVfsSaveMapping.buildWriteActionXml(
      "a.md",
      "anchor-not-unique",
      "full body",
    );
    assert.ok(xml.includes('<action name="write">'));
    assert.ok(xml.includes('"path": "a.md"'));
    assert.ok(xml.includes('"content": "full body"'));
  });
});
