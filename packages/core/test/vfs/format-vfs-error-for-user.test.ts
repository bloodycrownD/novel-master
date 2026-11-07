import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolError } from "../../src/errors/tool-errors.js";
import { VfsError } from "../../src/errors/vfs-errors.js";
import { vfsUserMessage } from "../../src/domain/vfs/logic/format-vfs-error-for-user.js";
import { tCore } from "../helpers/core-i18n.js";
import type { VfsScope } from "../../src/domain/vfs/logic/vfs-path-mapper.js";

const sessionScope: VfsScope = {
  kind: "session",
  projectId: "proj-1",
  sessionId: "sess-1",
};

/** descriptor → 经测试 translator 渲染后的中文文案（key 直读 zh-CN catalog）。 */
function render(error: unknown, scope?: VfsScope): string {
  return tCore(vfsUserMessage(error, scope));
}

describe("vfsUserMessage", () => {
  it("REPLACE_NOT_FOUND 返回中文刷新提示", () => {
    const err = new VfsError(
      "REPLACE_NOT_FOUND",
      "Replace string not found in /note.md",
      { path: "/projects/proj-1/sessions/sess-1/note.md" },
    );
    assert.equal(
      render(err, sessionScope),
      "文件内容已变更，无法应用本次修改。请刷新文件后重新编辑。",
    );
  });

  it("NOT_FOUND 返回中文不存在提示（CONFLICT 已随版本校验下线）", () => {
    const err = new VfsError("NOT_FOUND", "Path not found: /note.md", {
      path: "/projects/proj-1/sessions/sess-1/note.md",
    });
    assert.equal(
      render(err, sessionScope),
      "文件不存在或已被删除。",
    );
  });

  it("ALREADY_EXISTS 返回名称不能重复（双端共用映射，不再本地补）", () => {
    const err = new VfsError("ALREADY_EXISTS", "Path already exists: /note.md", {
      path: "/projects/proj-1/sessions/sess-1/note.md",
    });
    assert.equal(
      render(err, sessionScope),
      "名称不能重复",
    );
  });

  it("IPC 形态 { code: ALREADY_EXISTS } 同样返回名称不能重复", () => {
    assert.equal(
      render({
        code: "ALREADY_EXISTS",
        message: "Path already exists: /note.md",
      }),
      "名称不能重复",
    );
  });

  it("unwraps VfsError cause from ToolError", () => {
    const cause = new VfsError("REPLACE_NOT_FOUND", "Replace string not found in /note.md", {
      path: "/note.md",
    });
    const err = new ToolError("FAILED", "Tool failed: write", {
      toolName: "write",
      cause,
    });
    assert.equal(
      render(err, sessionScope),
      "文件内容已变更，无法应用本次修改。请刷新文件后重新编辑。",
    );
  });

  it("IPC 形态 { code, message } 走用户中文文案", () => {
    assert.equal(
      render({
        code: "REPLACE_NOT_FOUND",
        message: "Replace string not found",
      }),
      "文件内容已变更，无法应用本次修改。请刷新文件后重新编辑。",
    );
  });

  it("带 messageKey 的错误优先透传 descriptor（INVALID_NAME 迁移路径）", () => {
    const err = new VfsError("INVALID_NAME", {key: "error.vfs.invalid_name.blank"});
    assert.deepEqual(vfsUserMessage(err), {key: "error.vfs.invalid_name.blank"});
  });

  it("无表项 VFS code 走操作失败兜底（{detail} 取路径）", () => {
    const err = new VfsError("DIRECTORY_NOT_EMPTY", "Directory not empty: /note.md", {
      path: "/note.md",
    });
    assert.equal(render(err), "操作失败：/note.md");
  });
});
