import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolError } from "../../src/errors/tool-errors.js";
import { VfsError } from "../../src/errors/vfs-errors.js";
import { formatVfsErrorForUser } from "../../src/domain/vfs/logic/format-vfs-error-for-user.js";
import type { VfsScope } from "../../src/domain/vfs/logic/vfs-path-mapper.js";

const sessionScope: VfsScope = {
  kind: "session",
  projectId: "proj-1",
  sessionId: "sess-1",
};

describe("formatVfsErrorForUser", () => {
  it("REPLACE_NOT_FOUND 返回中文刷新提示", () => {
    const err = new VfsError(
      "REPLACE_NOT_FOUND",
      "Replace string not found in /note.md",
      { path: "/projects/proj-1/sessions/sess-1/note.md" },
    );
    assert.equal(
      formatVfsErrorForUser(err, sessionScope),
      "文件内容已变更，无法应用本次修改。请刷新文件后重新编辑。",
    );
  });

  it("CONFLICT 返回中文版本冲突提示", () => {
    const err = new VfsError("CONFLICT", "Version conflict", {
      path: "/projects/proj-1/sessions/sess-1/note.md",
      expectedVersion: 1,
      actualVersion: 2,
    });
    assert.equal(
      formatVfsErrorForUser(err, sessionScope),
      "文件版本冲突，请刷新后重试。",
    );
  });

  it("unwraps VfsError cause from ToolError", () => {
    const cause = new VfsError("CONFLICT", "Version conflict", {
      path: "/note.md",
    });
    const err = new ToolError("FAILED", "Tool failed: write", {
      toolName: "write",
      cause,
    });
    assert.equal(
      formatVfsErrorForUser(err, sessionScope),
      "文件版本冲突，请刷新后重试。",
    );
  });

  it("IPC 形态 { code, message } 走用户中文文案", () => {
    assert.equal(
      formatVfsErrorForUser({
        code: "REPLACE_NOT_FOUND",
        message: "Replace string not found",
      }),
      "文件内容已变更，无法应用本次修改。请刷新文件后重新编辑。",
    );
  });
});
