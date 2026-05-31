import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  renderWorktreeFileTree,
  worktreeFileTreeRootLabel,
} from "@novel-master/core";

describe("worktree file tree", () => {
  it("renders nested dirs and files", () => {
    const allDirs = new Set(["/", "/src", "/tests"]);
    const fileSet = new Set([
      "/src/index.ts",
      "/src/utils.ts",
      "/tests/index.test.ts",
      "/package.json",
      "/README.md",
    ]);
    const tree = renderWorktreeFileTree({
      scope: { kind: "session", projectId: "p1", sessionId: "s1" },
      allDirs,
      fileSet,
      dirRuleMap: new Map(),
      mtimeByPath: new Map(),
    });
    assert.equal(
      tree,
      [
        "workspace/",
        "├── src/",
        "│   ├── index.ts",
        "│   └── utils.ts",
        "├── tests/",
        "│   └── index.test.ts",
        "├── package.json",
        "└── README.md",
      ].join("\n"),
    );
  });

  it("uses template root label for project scope", () => {
    assert.equal(
      worktreeFileTreeRootLabel({ kind: "project", projectId: "p1" }),
      "template",
    );
  });

  it("returns root line only when empty", () => {
    const tree = renderWorktreeFileTree({
      scope: { kind: "session", projectId: "p1", sessionId: "s1" },
      allDirs: new Set(["/"]),
      fileSet: new Set(),
      dirRuleMap: new Map(),
      mtimeByPath: new Map(),
    });
    assert.equal(tree, "workspace/");
  });
});
