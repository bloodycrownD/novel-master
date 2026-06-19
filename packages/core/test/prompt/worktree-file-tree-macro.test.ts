import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderWorktreeFileTreeForMacro } from "../../src/domain/worktree/logic/worktree-file-tree.js";
import { filetreeMacroLoadStateLabel } from "../../src/domain/worktree/logic/worktree-labels.js";
import type { DisplayState } from "../../src/domain/worktree/model/worktree-types.js";

const sessionScope = {
  kind: "session" as const,
  projectId: "p1",
  sessionId: "s1",
};

describe("filetreeMacroLoadStateLabel", () => {
  const cases: Array<[DisplayState, string]> = [
    ["full", "全部加载"],
    ["header", "部分加载"],
    ["filename", "未加载"],
    ["hidden", "未加载"],
  ];

  for (const [state, label] of cases) {
    it(`${state} → ${label}`, () => {
      assert.equal(filetreeMacroLoadStateLabel(state), label);
    });
  }
});

describe("renderWorktreeFileTreeForMacro", () => {
  it("目录优先、同层字典序", () => {
    const allDirs = new Set(["/", "/a-dir"]);
    const fileSet = new Set(["/b.txt", "/a-dir/z.txt", "/a-dir/m.txt"]);
    const displayByPath = new Map<string, DisplayState>(
      [...fileSet].map((p) => [p, "full" as const]),
    );
    const tree = renderWorktreeFileTreeForMacro({
      scope: sessionScope,
      allDirs,
      fileSet,
      dirRuleMap: new Map(),
      mtimeByPath: new Map(),
      displayByPath,
    });
    assert.match(tree, /^\/\n/);
    const lines = tree.split("\n");
    const aDirIdx = lines.findIndex((l) => l.includes("a-dir/"));
    const bTxtIdx = lines.findIndex((l) => l.includes("b.txt"));
    assert.ok(aDirIdx >= 0 && bTxtIdx >= 0);
    assert.ok(aDirIdx < bTxtIdx, "目录应排在文件前");
    const mIdx = lines.findIndex((l) => l.includes("m.txt"));
    const zIdx = lines.findIndex((l) => l.includes("z.txt"));
    assert.ok(mIdx >= 0 && zIdx >= 0);
    assert.ok(mIdx < zIdx, "同层文件应字典序");
  });

  it("仅文件行追加加载状态后缀，目录行无后缀", () => {
    const allDirs = new Set(["/", "/notes", "/refs"]);
    const fileSet = new Set(["/notes/draft.md", "/refs/index.md"]);
    const displayByPath = new Map<string, DisplayState>([
      ["/notes/draft.md", "full"],
      ["/refs/index.md", "filename"],
    ]);
    const tree = renderWorktreeFileTreeForMacro({
      scope: sessionScope,
      allDirs,
      fileSet,
      dirRuleMap: new Map(),
      mtimeByPath: new Map(),
      displayByPath,
    });
    assert.match(tree, /draft\.md 全部加载/);
    assert.match(tree, /index\.md 未加载/);
    assert.match(tree, /notes\//);
    assert.doesNotMatch(tree, /notes\/ 全部加载/);
    assert.doesNotMatch(tree, /notes\/ 未加载/);
  });

  it("hidden 文件仍列出且行尾为未加载", () => {
    const allDirs = new Set(["/"]);
    const fileSet = new Set(["/hidden.md"]);
    const displayByPath = new Map<string, DisplayState>([
      ["/hidden.md", "hidden"],
    ]);
    const tree = renderWorktreeFileTreeForMacro({
      scope: sessionScope,
      allDirs,
      fileSet,
      dirRuleMap: new Map(),
      mtimeByPath: new Map(),
      displayByPath,
    });
    assert.match(tree, /hidden\.md 未加载/);
  });
});
