import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  FsCommand  } from "../../src/domain/tool/logic/fs-command.js";

describe("FsCommand.classify", () => {
  it("ls 只读", () => {
    assert.deepEqual(FsCommand.classify({ action: "ls", path: "/" }), {
      mutating: false,
      paths: null,
    });
    assert.deepEqual(
      FsCommand.classify({ action: "ls", path: "/dir", recursive: true }),
      { mutating: false, paths: null },
    );
  });

  it("写操作突变并返回路径", () => {
    assert.deepEqual(FsCommand.classify({ action: "rm", path: "/a" }), {
      mutating: true,
      paths: ["/a"],
    });
    assert.deepEqual(FsCommand.classify({ action: "mkdir", path: "/d" }), {
      mutating: true,
      paths: ["/d"],
    });
    assert.deepEqual(
      FsCommand.classify({ action: "mv", from: "/a", to: "/b" }),
      { mutating: true, paths: ["/a", "/b"] },
    );
    assert.deepEqual(
      FsCommand.classify({
        action: "cp",
        from: "/src",
        to: "/dst",
        recursive: true,
      }),
      { mutating: true, paths: ["/src", "/dst"] },
    );
  });

  it("无 action 非突变、无路径", () => {
    assert.deepEqual(FsCommand.classify({}), {
      mutating: false,
      paths: null,
    });
    assert.deepEqual(FsCommand.classify({ action: "" }), {
      mutating: false,
      paths: null,
    });
    assert.deepEqual(FsCommand.classify(null), {
      mutating: false,
      paths: null,
    });
    assert.deepEqual(FsCommand.classify(undefined), {
      mutating: false,
      paths: null,
    });
  });

  it("解析失败保守突变、无路径", () => {
    assert.deepEqual(FsCommand.classify({ action: "bad" }), {
      mutating: true,
      paths: null,
    });
    assert.deepEqual(FsCommand.classify({ action: "rm" }), {
      mutating: true,
      paths: null,
    });
  });
});

describe("FsCommand.classifyMutatingToolCall", () => {
  it("write/edit 返回 path", () => {
    assert.deepEqual(
      FsCommand.classifyMutatingToolCall("write", { path: "/a.txt", content: "x" }),
      { mutating: true, paths: ["/a.txt"] },
    );
    assert.deepEqual(
      FsCommand.classifyMutatingToolCall("edit", { path: "/b.txt", old: "a", new: "b" }),
      { mutating: true, paths: ["/b.txt"] },
    );
  });

  it("write/edit 空 path 突变但无路径", () => {
    assert.deepEqual(FsCommand.classifyMutatingToolCall("write", { content: "x" }), {
      mutating: true,
      paths: null,
    });
  });

  it("fs ls 只读", () => {
    assert.deepEqual(
      FsCommand.classifyMutatingToolCall("fs", { action: "ls", path: "/" }),
      { mutating: false, paths: null },
    );
  });

  it("fs 无 action 非突变", () => {
    assert.deepEqual(FsCommand.classifyMutatingToolCall("fs", {}), {
      mutating: false,
      paths: null,
    });
  });

  it("read 等非突变 tool", () => {
    assert.deepEqual(FsCommand.classifyMutatingToolCall("read", { path: "/a" }), {
      mutating: false,
      paths: null,
    });
  });

  it("skill write/edit 返回带 domain 的合成键", () => {
    // write 缺省 domain=project（与 skill-tool 的 write 分支同口径）
    assert.deepEqual(
      FsCommand.classifyMutatingToolCall("skill", {
        action: "write",
        name: "demo",
        content: "x",
      }),
      { mutating: true, paths: ["skill:project:/meta/skills/demo/SKILL.md"] },
    );
    assert.deepEqual(
      FsCommand.classifyMutatingToolCall("skill", {
        action: "edit",
        name: "demo",
        domain: "global",
        oldString: "a",
        newString: "b",
      }),
      { mutating: true, paths: ["skill:global:/meta/skills/demo/SKILL.md"] },
    );
    // 嵌套相对路径归一化后进键（与 service 层 resolveSkillRelPath 同内核）
    assert.deepEqual(
      FsCommand.classifyMutatingToolCall("skill", {
        action: "edit",
        name: "demo",
        domain: "global",
        path: "./notes/a.md",
        oldString: "a",
        newString: "b",
      }),
      { mutating: true, paths: ["skill:global:/meta/skills/demo/notes/a.md"] },
    );
  });

  it("skill load/read/list 只读；非法输入保守突变不排队", () => {
    assert.deepEqual(
      FsCommand.classifyMutatingToolCall("skill", { action: "load", name: "demo" }),
      { mutating: false, paths: null },
    );
    assert.deepEqual(
      FsCommand.classifyMutatingToolCall("skill", { action: "read", name: "demo" }),
      { mutating: false, paths: null },
    );
    assert.deepEqual(FsCommand.classifyMutatingToolCall("skill", { action: "list" }), {
      mutating: false,
      paths: null,
    });
    // edit 缺 domain（schema 会拒）→ 突变但不排队
    assert.deepEqual(
      FsCommand.classifyMutatingToolCall("skill", {
        action: "edit",
        name: "demo",
        oldString: "a",
        newString: "b",
      }),
      { mutating: true, paths: null },
    );
    // path 带 .. → 突变但不排队
    assert.deepEqual(
      FsCommand.classifyMutatingToolCall("skill", {
        action: "edit",
        name: "demo",
        domain: "global",
        path: "../other/SKILL.md",
        oldString: "a",
        newString: "b",
      }),
      { mutating: true, paths: null },
    );
  });
});
