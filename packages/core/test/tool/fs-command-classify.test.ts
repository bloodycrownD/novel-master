import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyFsCommand,
  classifyMutatingToolCall,
} from "../../src/domain/tool/logic/fs-command-classify.js";

describe("classifyFsCommand", () => {
  it("ls 只读", () => {
    assert.deepEqual(classifyFsCommand({ action: "ls", path: "/" }), {
      mutating: false,
      paths: null,
    });
    assert.deepEqual(
      classifyFsCommand({ action: "ls", path: "/dir", recursive: true }),
      { mutating: false, paths: null },
    );
  });

  it("写操作突变并返回路径", () => {
    assert.deepEqual(classifyFsCommand({ action: "rm", path: "/a" }), {
      mutating: true,
      paths: ["/a"],
    });
    assert.deepEqual(classifyFsCommand({ action: "mkdir", path: "/d" }), {
      mutating: true,
      paths: ["/d"],
    });
    assert.deepEqual(
      classifyFsCommand({ action: "mv", from: "/a", to: "/b" }),
      { mutating: true, paths: ["/a", "/b"] },
    );
    assert.deepEqual(
      classifyFsCommand({
        action: "cp",
        from: "/src",
        to: "/dst",
        recursive: true,
      }),
      { mutating: true, paths: ["/src", "/dst"] },
    );
  });

  it("无 action 非突变、无路径", () => {
    assert.deepEqual(classifyFsCommand({}), {
      mutating: false,
      paths: null,
    });
    assert.deepEqual(classifyFsCommand({ action: "" }), {
      mutating: false,
      paths: null,
    });
    assert.deepEqual(classifyFsCommand(null), {
      mutating: false,
      paths: null,
    });
    assert.deepEqual(classifyFsCommand(undefined), {
      mutating: false,
      paths: null,
    });
  });

  it("解析失败保守突变、无路径", () => {
    assert.deepEqual(classifyFsCommand({ action: "bad" }), {
      mutating: true,
      paths: null,
    });
    assert.deepEqual(classifyFsCommand({ action: "rm" }), {
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
    assert.deepEqual(
      classifyMutatingToolCall("fs", { action: "ls", path: "/" }),
      { mutating: false, paths: null },
    );
  });

  it("fs 无 action 非突变", () => {
    assert.deepEqual(classifyMutatingToolCall("fs", {}), {
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

  it("skill write/edit 返回带 domain 的合成键", () => {
    // write 缺省 domain=project（与 skill-tool 的 write 分支同口径）
    assert.deepEqual(
      classifyMutatingToolCall("skill", {
        action: "write",
        name: "demo",
        content: "x",
      }),
      { mutating: true, paths: ["skill:project:/meta/skills/demo/SKILL.md"] },
    );
    assert.deepEqual(
      classifyMutatingToolCall("skill", {
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
      classifyMutatingToolCall("skill", {
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
      classifyMutatingToolCall("skill", { action: "load", name: "demo" }),
      { mutating: false, paths: null },
    );
    assert.deepEqual(
      classifyMutatingToolCall("skill", { action: "read", name: "demo" }),
      { mutating: false, paths: null },
    );
    assert.deepEqual(classifyMutatingToolCall("skill", { action: "list" }), {
      mutating: false,
      paths: null,
    });
    // edit 缺 domain（schema 会拒）→ 突变但不排队
    assert.deepEqual(
      classifyMutatingToolCall("skill", {
        action: "edit",
        name: "demo",
        oldString: "a",
        newString: "b",
      }),
      { mutating: true, paths: null },
    );
    // path 带 .. → 突变但不排队
    assert.deepEqual(
      classifyMutatingToolCall("skill", {
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
