/**
 * synthesize-user-vfs-flush-actions 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkspaceFlushDiff } from "../../src/domain/chat/logic/diff-workspace-for-user-vfs-flush.js";
import { synthesizeUserVfsFlushActions } from "../../src/domain/chat/logic/synthesize-user-vfs-flush-actions.js";
import { parseAllUserVfsActionsFromText } from "../../src/domain/chat/logic/user-vfs-turn-view.js";

describe("synthesizeUserVfsFlushActions", () => {
  it("空 diff 返回空字符串", () => {
    const diff: WorkspaceFlushDiff = {
      deletedFiles: [],
      addedFiles: [],
      changedFiles: [],
      addedDirs: [],
      deletedDirs: [],
      renames: [],
    };
    assert.equal(synthesizeUserVfsFlushActions(diff), "");
  });

  it("输出含可解析的 action", () => {
    const diff: WorkspaceFlushDiff = {
      addedDirs: ["/notes"],
      addedFiles: [{ path: "/notes/a.md", content: "hello" }],
      changedFiles: [],
      deletedFiles: [],
      deletedDirs: [],
      renames: [],
    };
    const xml = synthesizeUserVfsFlushActions(diff);
    assert.ok(xml.includes("<action"));
    assert.ok(xml.includes('"content": "hello"'));
    const actions = parseAllUserVfsActionsFromText(xml);
    assert.equal(actions.length, 2);
    assert.equal(actions[0]?.name, "mkdir");
    assert.equal(actions[0]?.path, "/notes");
    assert.equal(actions[1]?.name, "write");
    assert.equal(actions[1]?.path, "/notes/a.md");
  });

  it("rename 输出 name=rename 而非 delete+write", () => {
    const diff: WorkspaceFlushDiff = {
      renames: [{ from: "/a.md", to: "/b.md" }],
      addedFiles: [],
      changedFiles: [],
      deletedFiles: [],
      deletedDirs: [],
      addedDirs: [],
    };
    const xml = synthesizeUserVfsFlushActions(diff);
    const actions = parseAllUserVfsActionsFromText(xml);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.name, "rename");
    assert.ok(!xml.includes('"name": "delete"'));
    assert.ok(!xml.includes('name="write"'));
  });

  it("内容变更合成 edit 或 write action", () => {
    const diff: WorkspaceFlushDiff = {
      changedFiles: [
        {
          path: "/ch.md",
          baselineContent: "line1\nline2\nline3",
          currentContent: "line1\nLINE2\nline3",
        },
      ],
      addedFiles: [],
      deletedFiles: [],
      deletedDirs: [],
      addedDirs: [],
      renames: [],
    };
    const xml = synthesizeUserVfsFlushActions(diff);
    assert.ok(xml.includes("<action"));
    const actions = parseAllUserVfsActionsFromText(xml);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.name, "edit");
    assert.equal(actions[0]?.path, "/ch.md");
  });

  it("删除文件合成 delete action", () => {
    const diff: WorkspaceFlushDiff = {
      deletedFiles: ["/gone.md"],
      addedFiles: [],
      changedFiles: [],
      addedDirs: [],
      deletedDirs: [],
      renames: [],
    };
    const xml = synthesizeUserVfsFlushActions(diff);
    const actions = parseAllUserVfsActionsFromText(xml);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.name, "delete");
    assert.equal(actions[0]?.path, "/gone.md");
  });
});
