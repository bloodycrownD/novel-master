import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderWorkplaceFileTree, workplaceFileTreeRootLabel } from "@novel-master/core/workplace";

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
    const tree = renderWorkplaceFileTree({
      scope: { kind: "session", projectId: "p1", sessionId: "s1" },
      allDirs,
      fileSet,
      dirRuleMap: new Map(),
      mtimeByPath: new Map(),
    });
    assert.equal(
      tree,
      [
        "/",
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

  it("uses / root label for project scope", () => {
    assert.equal(
      workplaceFileTreeRootLabel({ kind: "project", projectId: "p1" }),
      "/",
    );
  });

  it("returns root line only when empty", () => {
    const tree = renderWorkplaceFileTree({
      scope: { kind: "session", projectId: "p1", sessionId: "s1" },
      allDirs: new Set(["/"]),
      fileSet: new Set(),
      dirRuleMap: new Map(),
      mtimeByPath: new Map(),
    });
    assert.equal(tree, "/");
  });
});
