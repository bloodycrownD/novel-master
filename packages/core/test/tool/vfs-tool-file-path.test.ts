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

  it("Bug1: input.file_path 字段名兼容（path 缺失时回退）", () => {
    // 某些 LLM 会用 file_path 而非标准的 path，v1 加兼容兼容。
    assert.equal(
      resolveVfsToolFilePath("write", { file_path: "a.md" }),
      "/a.md",
    );
    assert.equal(
      resolveVfsToolFilePath("edit", { file_path: "notes/a.md" }),
      "/notes/a.md",
    );
    assert.equal(
      resolveVfsToolFilePath("vfs.read", { file_path: "/x.md" }),
      "/x.md",
    );
  });

  it("Bug1: path 优先于 file_path（两者同在时以 path 为准）", () => {
    assert.equal(
      resolveVfsToolFilePath("write", { path: "a.md", file_path: "b.md" }),
      "/a.md",
    );
  });

  it("Bug1: path 与 file_path 均非字符串时返回 undefined", () => {
    assert.equal(
      resolveVfsToolFilePath("write", { path: 123, file_path: null }),
      undefined,
    );
  });
});
