/**
 * diff-workspace-for-user-vfs-flush 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  diffWorkspaceForUserVfsFlush,
  isWorkspaceFlushDiffEmpty,
} from "../../src/domain/chat/logic/diff-workspace-for-user-vfs-flush.js";
import {
  deriveDirPathsFromFileTree,
  type WorkspaceFlushSnapshot,
} from "../../src/domain/chat/logic/workspace-flush-snapshot.js";

function snapshot(
  files: ReadonlyArray<[string, number]>,
  dirs?: ReadonlyArray<string>,
): WorkspaceFlushSnapshot {
  const fileTree = new Map(files);
  return {
    fileTree,
    dirPaths: dirs != null ? new Set(dirs) : deriveDirPathsFromFileTree(fileTree),
  };
}

describe("diffWorkspaceForUserVfsFlush", () => {
  it("baseline 与 current 相同 → 空 diff", () => {
    const snap = snapshot([["/a.md", 1]], ["/"]);
    const diff = diffWorkspaceForUserVfsFlush({
      baseline: snap,
      current: snap,
      baselineContentByPath: new Map([["/a.md", "hello"]]),
      currentContentByPath: new Map([["/a.md", "hello"]]),
    });
    assert.equal(isWorkspaceFlushDiffEmpty(diff), true);
  });

  it("删目录再 mkdir 同路径 → 目录净变更为空", () => {
    const baseline = snapshot([], ["/drafts"]);
    const current = snapshot([], ["/drafts"]);
    const diff = diffWorkspaceForUserVfsFlush({
      baseline,
      current,
      baselineContentByPath: new Map(),
      currentContentByPath: new Map(),
    });
    assert.equal(isWorkspaceFlushDiffEmpty(diff), true);
  });

  it("rename A→B→A 往返 → 空 diff", () => {
    const content = "same body";
    const snap = snapshot([["/a.md", 1]], ["/"]);
    const diff = diffWorkspaceForUserVfsFlush({
      baseline: snap,
      current: snap,
      baselineContentByPath: new Map([["/a.md", content]]),
      currentContentByPath: new Map([["/a.md", content]]),
    });
    assert.equal(isWorkspaceFlushDiffEmpty(diff), true);
    assert.equal(diff.renames.length, 0);
  });

  it("内容变更后又改回 → 空 diff", () => {
    const snap = snapshot([["/edit.md", 2]], ["/"]);
    const diff = diffWorkspaceForUserVfsFlush({
      baseline: snap,
      current: snap,
      baselineContentByPath: new Map([["/edit.md", "original"]]),
      currentContentByPath: new Map([["/edit.md", "original"]]),
    });
    assert.equal(isWorkspaceFlushDiffEmpty(diff), true);
    assert.equal(diff.changedFiles.length, 0);
  });

  it("仅新增文件 → addedFiles 含正文", () => {
    const baseline = snapshot([]);
    const current = snapshot([["/new.md", 1]], ["/"]);
    const diff = diffWorkspaceForUserVfsFlush({
      baseline,
      current,
      baselineContentByPath: new Map(),
      currentContentByPath: new Map([["/new.md", "fresh"]]),
    });
    assert.equal(diff.addedFiles.length, 1);
    assert.equal(diff.addedFiles[0]?.path, "/new.md");
    assert.equal(diff.addedFiles[0]?.content, "fresh");
    assert.equal(diff.addedDirs.length, 0);
  });

  it("删除文件 → deletedFiles", () => {
    const baseline = snapshot([["/gone.md", 1]], ["/"]);
    const current = snapshot([]);
    const diff = diffWorkspaceForUserVfsFlush({
      baseline,
      current,
      baselineContentByPath: new Map([["/gone.md", "x"]]),
      currentContentByPath: new Map(),
    });
    assert.deepEqual(diff.deletedFiles, ["/gone.md"]);
  });

  it("同内容删增不同 path → 配对为 rename", () => {
    const body = "identical";
    const baseline = snapshot([["/old.md", 1]], ["/"]);
    const current = snapshot([["/new.md", 1]], ["/"]);
    const diff = diffWorkspaceForUserVfsFlush({
      baseline,
      current,
      baselineContentByPath: new Map([["/old.md", body]]),
      currentContentByPath: new Map([["/new.md", body]]),
    });
    assert.deepEqual(diff.renames, [{ from: "/old.md", to: "/new.md" }]);
    assert.equal(diff.deletedFiles.length, 0);
    assert.equal(diff.addedFiles.length, 0);
  });

  it("同 path 正文变更 → changedFiles", () => {
    const snap = snapshot([["/ch.md", 3]], ["/"]);
    const diff = diffWorkspaceForUserVfsFlush({
      baseline: snap,
      current: snap,
      baselineContentByPath: new Map([["/ch.md", "before"]]),
      currentContentByPath: new Map([["/ch.md", "after"]]),
    });
    assert.equal(diff.changedFiles.length, 1);
    assert.equal(diff.changedFiles[0]?.path, "/ch.md");
    assert.equal(diff.changedFiles[0]?.baselineContent, "before");
    assert.equal(diff.changedFiles[0]?.currentContent, "after");
  });

  it("新增空目录 → addedDirs", () => {
    const baseline = snapshot([["/a.md", 1]], ["/"]);
    const current = snapshot([["/a.md", 1]], ["/", "/empty"]);
    const diff = diffWorkspaceForUserVfsFlush({
      baseline,
      current,
      baselineContentByPath: new Map([["/a.md", "x"]]),
      currentContentByPath: new Map([["/a.md", "x"]]),
    });
    assert.deepEqual(diff.addedDirs, ["/empty"]);
  });

  it("删除目录且其下无文件 → deletedDirs", () => {
    const baseline = snapshot([["/a.md", 1]], ["/", "/old-dir"]);
    const current = snapshot([["/a.md", 1]], ["/"]);
    const diff = diffWorkspaceForUserVfsFlush({
      baseline,
      current,
      baselineContentByPath: new Map([["/a.md", "x"]]),
      currentContentByPath: new Map([["/a.md", "x"]]),
    });
    assert.deepEqual(diff.deletedDirs, ["/old-dir"]);
  });
});
