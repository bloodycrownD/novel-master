import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeHeadTailIndices,
  evaluateFileDisplay,
} from "@novel-master/core";

describe("worktree eval", () => {
  it("hide and show take priority", () => {
    assert.equal(
      evaluateFileDisplay({
        inclusion: "hide",
        parentRuleOn: true,
        dirRule: null,
        indexInSortedAutoFiles: 0,
        autoFileCount: 1,
        logicalPath: "/a.md",
      }),
      "hidden",
    );
    assert.equal(
      evaluateFileDisplay({
        inclusion: "show",
        parentRuleOn: false,
        dirRule: null,
        indexInSortedAutoFiles: 0,
        autoFileCount: 1,
        logicalPath: "/a.md",
      }),
      "full",
    );
  });

  it("auto with parent rule off is hidden", () => {
    assert.equal(
      evaluateFileDisplay({
        inclusion: "auto",
        parentRuleOn: false,
        dirRule: null,
        indexInSortedAutoFiles: 0,
        autoFileCount: 1,
        logicalPath: "/a.md",
      }),
      "hidden",
    );
  });

  it("head=2 tail=1 dedupes to three full slots", () => {
    const priority = computeHeadTailIndices(5, 2, 1);
    assert.equal(priority.size, 3);
    assert.deepEqual([...priority].sort(), [0, 1, 4]);
  });

  it("fill header on non-md is hidden", () => {
    assert.equal(
      evaluateFileDisplay({
        inclusion: "auto",
        parentRuleOn: true,
        dirRule: {
          scopeKey: "global",
          logicalPath: "/",
          ruleEnabled: true,
          sortField: "name",
          sortOrder: "asc",
          headCount: 0,
          tailCount: 0,
          fillPolicy: "header",
        },
        indexInSortedAutoFiles: 1,
        autoFileCount: 2,
        logicalPath: "/readme.txt",
      }),
      "hidden",
    );
  });

  it("fill full shows full content for non-priority auto file", () => {
    assert.equal(
      evaluateFileDisplay({
        inclusion: "auto",
        parentRuleOn: true,
        dirRule: {
          scopeKey: "global",
          logicalPath: "/",
          ruleEnabled: true,
          sortField: "name",
          sortOrder: "asc",
          headCount: 1,
          tailCount: 0,
          fillPolicy: "full",
        },
        indexInSortedAutoFiles: 1,
        autoFileCount: 2,
        logicalPath: "/b.txt",
      }),
      "full",
    );
  });

  it("fill filename for non-priority auto file", () => {
    assert.equal(
      evaluateFileDisplay({
        inclusion: "auto",
        parentRuleOn: true,
        dirRule: {
          scopeKey: "global",
          logicalPath: "/",
          ruleEnabled: true,
          sortField: "name",
          sortOrder: "asc",
          headCount: 0,
          tailCount: 0,
          fillPolicy: "filename",
        },
        indexInSortedAutoFiles: 1,
        autoFileCount: 2,
        logicalPath: "/b.md",
      }),
      "filename",
    );
  });
});
