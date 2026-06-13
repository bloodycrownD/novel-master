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
    assert.equal(toolUseMutatesWorkspace("fs", { command: "ls /" }), false);
    assert.equal(
      toolUseMutatesWorkspace("fs", { command: "ls -r /dir" }),
      false,
    );
  });

  it("fs 写操作突变", () => {
    assert.equal(toolUseMutatesWorkspace("fs", { command: "rm /a" }), true);
    assert.equal(toolUseMutatesWorkspace("fs", { command: "mkdir /d" }), true);
    assert.equal(
      toolUseMutatesWorkspace("fs", { command: "mv /a /b" }),
      true,
    );
  });

  it("fs 命令解析失败时保守视为突变", () => {
    assert.equal(toolUseMutatesWorkspace("fs", { command: "bad cmd" }), true);
    assert.equal(toolUseMutatesWorkspace("fs", { command: "" }), true);
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
