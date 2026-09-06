import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeHeadTailIndices,
  evaluateFileDisplay,
  sortDirPaths,
  sortFilesForDir,
} from "@novel-master/core/workplace";

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

  it("uses default fill header for non-priority auto file when dirRule is null", () => {
    assert.equal(
      evaluateFileDisplay({
        inclusion: "auto",
        parentRuleOn: true,
        dirRule: null,
        indexInSortedAutoFiles: 500,
        autoFileCount: 2000,
        logicalPath: "/middle.md",
      }),
      "header",
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

describe("T-WE1: sortFilesForDir smart case", () => {
  const zhChapterRegex = /第([0-9〇零一二两三四五六七八九十百千万]{1,12})章/;
  const smartRules = [{ ruleId: "t-zh", name: "t", regex: zhChapterRegex }];
  const files = [
    { logicalPath: "/b/第十章.txt", mtimeMs: 1 },
    { logicalPath: "/b/第四章.txt", mtimeMs: 2 },
    { logicalPath: "/b/第一章.txt", mtimeMs: 3 },
  ];
  const dirRule = {
    scopeKey: "global",
    logicalPath: "/b",
    ruleEnabled: true,
    sortField: "smart" as const,
    sortOrder: "asc" as const,
    headCount: 0,
    tailCount: 0,
    fillPolicy: "hidden" as const,
  };
  const names = (sorted: { logicalPath: string }[]) =>
    sorted.map((f) => f.logicalPath.split("/").pop());

  it("smart with rules orders by extracted ordinals (第四章 [4] before 第十章 [10])", () => {
    const sorted = sortFilesForDir(files, dirRule, { smartRules });
    assert.deepEqual(names(sorted), ["第一章.txt", "第四章.txt", "第十章.txt"]);
  });

  it("smart desc reverses the ordinal order", () => {
    const sorted = sortFilesForDir(files, { ...dirRule, sortOrder: "desc" }, { smartRules });
    assert.deepEqual(names(sorted), ["第十章.txt", "第四章.txt", "第一章.txt"]);
  });

  it("smart without rules degrades to natural order (码位序：十 U+5341 < 四 U+56DB)", () => {
    const sorted = sortFilesForDir(files, dirRule);
    assert.deepEqual(names(sorted), ["第一章.txt", "第十章.txt", "第四章.txt"]);
  });

  it("smart without rules degrades to natural order even with empty opts", () => {
    const sorted = sortFilesForDir(files, dirRule, {});
    assert.deepEqual(names(sorted), ["第一章.txt", "第十章.txt", "第四章.txt"]);
  });

  it("两参旧调用（无 opts）不破坏：name 排序照旧（localeCompare 拼音序）", () => {
    const sorted = sortFilesForDir(files, { ...dirRule, sortField: "name" });
    assert.deepEqual(names(sorted), ["第十章.txt", "第四章.txt", "第一章.txt"]);
  });
});

describe("T-WE2: sortDirPaths 按 sortField 分派", () => {
  const rule = (sortField: "name" | "created" | "updated" | "smart", sortOrder: "asc" | "desc" = "asc") => ({
    scopeKey: "global",
    logicalPath: "/a",
    ruleEnabled: true,
    sortField,
    sortOrder,
    headCount: 0,
    tailCount: 0,
    fillPolicy: "hidden" as const,
  });
  const paths = ["/a/m9", "/a/m10", "/a/m2"];
  const volumePaths = ["/a/第十卷", "/a/第四卷", "/a/第一卷"];
  const smartRules = [
    { ruleId: "t-zh", name: "t", regex: /第([0-9〇零一二两三四五六七八九十百千万]{1,12})(?:章|卷)/ },
  ];

  it("name 零回归：basename 字典序 + path tiebreak", () => {
    assert.deepEqual(sortDirPaths(paths, rule("name")), ["/a/m10", "/a/m2", "/a/m9"]);
  });

  it("created/updated 用目录 mtime 数值比（asc/desc 方向）", () => {
    const dirMtimeByPath = new Map([
      ["/a/m9", 300],
      ["/a/m10", 100],
      ["/a/m2", 200],
    ]);
    assert.deepEqual(sortDirPaths(paths, rule("created"), { dirMtimeByPath }), [
      "/a/m10",
      "/a/m2",
      "/a/m9",
    ]);
    assert.deepEqual(sortDirPaths(paths, rule("updated", "desc"), { dirMtimeByPath }), [
      "/a/m9",
      "/a/m2",
      "/a/m10",
    ]);
  });

  it("D7 退化分支：缺省 dirMtimeByPath 时 created/updated 与 name 输出一致", () => {
    assert.deepEqual(sortDirPaths(paths, rule("created")), sortDirPaths(paths, rule("name")));
    assert.deepEqual(sortDirPaths(paths, rule("updated")), sortDirPaths(paths, rule("name")));
    // 部分 mtime 缺失（孤儿路径）时，缺失端也走 name 退化
    const partial = new Map([
      ["/a/m9", 300],
      ["/a/m2", 200],
    ]);
    assert.deepEqual(sortDirPaths(paths, rule("created"), { dirMtimeByPath: partial }), [
      "/a/m10",
      "/a/m2",
      "/a/m9",
    ]);
  });

  it("smart 用序号排序目录名（第四卷 [4] before 第十卷 [10]，自然序相反）", () => {
    assert.deepEqual(sortDirPaths(volumePaths, rule("smart"), { smartRules }), [
      "/a/第一卷",
      "/a/第四卷",
      "/a/第十卷",
    ]);
    // 缺省规则退化为自然序（码位：一 < 十 < 四）
    assert.deepEqual(sortDirPaths(volumePaths, rule("smart")), [
      "/a/第一卷",
      "/a/第十卷",
      "/a/第四卷",
    ]);
  });
});
