import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anyToolUseMutatesWorkspace,
  toolUseMutatesWorkspace,
} from "../../src/domain/tool/logic/tool-use-mutates-workspace.js";

describe("tool-use-mutates-workspace", () => {
  it("write/edit 视为突变", () => {
    assert.equal(
      toolUseMutatesWorkspace("write", { path: "/a.txt", content: "x" }),
      true,
    );
    assert.equal(
      toolUseMutatesWorkspace("edit", { path: "/a.txt", old: "a", new: "b" }),
      true,
    );
  });

  it("read/glob/grep 不突变工作区", () => {
    assert.equal(toolUseMutatesWorkspace("read", { path: "/a.txt" }), false);
    assert.equal(toolUseMutatesWorkspace("glob", { pattern: "**/*" }), false);
    assert.equal(toolUseMutatesWorkspace("grep", { pattern: "foo" }), false);
  });

  it("fs ls 只读不突变", () => {
    assert.equal(toolUseMutatesWorkspace("fs", { action: "ls", path: "/" }), false);
    assert.equal(
      toolUseMutatesWorkspace("fs", { action: "ls", path: "/dir", recursive: true }),
      false,
    );
  });

  it("fs 写操作突变", () => {
    assert.equal(toolUseMutatesWorkspace("fs", { action: "rm", path: "/a" }), true);
    assert.equal(toolUseMutatesWorkspace("fs", { action: "mkdir", path: "/d" }), true);
    assert.equal(
      toolUseMutatesWorkspace("fs", { action: "mv", from: "/a", to: "/b" }),
      true,
    );
  });

  it("fs 命令解析失败时保守视为突变", () => {
    assert.equal(toolUseMutatesWorkspace("fs", { action: "bad" }), true);
    assert.equal(toolUseMutatesWorkspace("fs", { action: "" }), true);
  });

  it("anyToolUseMutatesWorkspace 并行任一轮突变即 true", () => {
    assert.equal(
      anyToolUseMutatesWorkspace([
        { name: "read", input: { path: "/a" } },
        { name: "write", input: { path: "/b", content: "x" } },
      ]),
      true,
    );
    assert.equal(
      anyToolUseMutatesWorkspace([
        { name: "read", input: { path: "/a" } },
        { name: "grep", input: { pattern: "x" } },
      ]),
      false,
    );
  });
});
