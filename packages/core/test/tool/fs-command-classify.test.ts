import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyFsCommand,
  classifyMutatingToolCall,
} from "../../src/domain/tool/logic/fs-command-classify.js";

describe("classifyFsCommand", () => {
  it("ls 只读", () => {
    assert.deepEqual(classifyFsCommand("ls /"), {
      mutating: false,
      paths: null,
    });
    assert.deepEqual(classifyFsCommand("ls -r /dir"), {
      mutating: false,
      paths: null,
    });
  });

  it("写操作突变并返回路径", () => {
    assert.deepEqual(classifyFsCommand("rm /a"), {
      mutating: true,
      paths: ["/a"],
    });
    assert.deepEqual(classifyFsCommand("mkdir /d"), {
      mutating: true,
      paths: ["/d"],
    });
    assert.deepEqual(classifyFsCommand("mv /a /b"), {
      mutating: true,
      paths: ["/a", "/b"],
    });
    assert.deepEqual(classifyFsCommand("cp -r /src /dst"), {
      mutating: true,
      paths: ["/src", "/dst"],
    });
  });

  it("空 command 非突变、无路径", () => {
    assert.deepEqual(classifyFsCommand(""), {
      mutating: false,
      paths: null,
    });
    assert.deepEqual(classifyFsCommand("   "), {
      mutating: false,
      paths: null,
    });
  });

  it("解析失败保守突变、无路径", () => {
    assert.deepEqual(classifyFsCommand("bad cmd"), {
      mutating: true,
      paths: null,
    });
  });
});

describe("classifyMutatingToolCall", () => {
  it("write/edit 返回 path", () => {
    assert.deepEqual(
      classifyMutatingToolCall("write", { path: "/a.txt", content: "x" }),
      { mutating: true, paths: ["/a.txt"] },
    );
    assert.deepEqual(
      classifyMutatingToolCall("edit", { path: "/b.txt", old: "a", new: "b" }),
      { mutating: true, paths: ["/b.txt"] },
    );
  });

  it("write/edit 空 path 突变但无路径", () => {
    assert.deepEqual(classifyMutatingToolCall("write", { content: "x" }), {
      mutating: true,
      paths: null,
    });
  });

  it("fs ls 只读", () => {
    assert.deepEqual(classifyMutatingToolCall("fs", { command: "ls /" }), {
      mutating: false,
      paths: null,
    });
  });

  it("fs 空 command 非突变", () => {
    assert.deepEqual(classifyMutatingToolCall("fs", { command: "" }), {
      mutating: false,
      paths: null,
    });
  });

  it("read 等非突变 tool", () => {
    assert.deepEqual(classifyMutatingToolCall("read", { path: "/a" }), {
      mutating: false,
      paths: null,
    });
  });
});
