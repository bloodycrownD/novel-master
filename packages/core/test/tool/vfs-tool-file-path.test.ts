import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveVfsToolFilePath } from "../../src/domain/tool/logic/vfs-tool-file-path.js";

describe("resolveVfsToolFilePath", () => {
  it("write 相对路径规范化为绝对逻辑路径", () => {
    assert.equal(resolveVfsToolFilePath("write", { path: "a.md" }), "/a.md");
    assert.equal(
      resolveVfsToolFilePath("write", { path: "notes/a.md" }),
      "/notes/a.md",
    );
  });

  it("write 绝对路径保持不变", () => {
    assert.equal(resolveVfsToolFilePath("write", { path: "/x.md" }), "/x.md");
  });

  it("vfs.read 前缀剥离后规范化", () => {
    assert.equal(resolveVfsToolFilePath("vfs.read", { path: "y.md" }), "/y.md");
  });

  it("write 首尾空白 trim 后规范化", () => {
    assert.equal(
      resolveVfsToolFilePath("write", { path: "  a.md  " }),
      "/a.md",
    );
  });

  it("write 空 path 返回 undefined", () => {
    assert.equal(resolveVfsToolFilePath("write", { path: "" }), undefined);
  });

  it("write 非法 .. 路径返回 undefined", () => {
    assert.equal(resolveVfsToolFilePath("write", { path: "/../x" }), undefined);
  });

  it("delete 等非打开工具返回 undefined", () => {
    assert.equal(resolveVfsToolFilePath("delete", { path: "a.md" }), undefined);
  });

  it("fs 无 path 返回 undefined", () => {
    assert.equal(resolveVfsToolFilePath("fs", { command: "ls /" }), undefined);
  });
});
