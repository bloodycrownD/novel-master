import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "@novel-master/core/errors";
import { createAbortError } from "@novel-master/core/abort";
import { userMessageOf } from "@novel-master/core/i18n";
import { coreT } from "../shared/logic/core-i18n.js";
import { AssertionError } from "../../../packages/core/src/common/assert.js";
import { formatIpcError } from "../src/main/ipc/format-ipc-error.js";

describe("formatIpcError", () => {
  it("透传 SESSION_FS_ROLLBACK_NO_CHECKPOINT AppError（code 即 key，中文经 coreT 渲染）", () => {
    const err = new AppError("SESSION_FS_ROLLBACK_NO_CHECKPOINT", {
      messageId: "msg-1",
      sessionId: "sess-1",
    });
    const payload = formatIpcError(err);
    assert.equal(payload.code, "SESSION_FS_ROLLBACK_NO_CHECKPOINT");
    assert.equal(payload.message, "该消息无回滚点");
  });

  it("SESSION_FS_ROLLBACK_VFS_RESTORE_FAILED：descriptor 通道走 coreT，code 即 key", () => {
    // descriptor 走 params.descriptor 通道（message-rollback.service 同构；直接把
    // descriptor 当 params 会让 messageParams 变成 toSnakeCase(整包) 而丢插值）。
    const err = new AppError("SESSION_FS_ROLLBACK_VFS_RESTORE_FAILED", {
      descriptor: {
        key: "error.session_fs.vfs_restore_failed",
        params: { detail: "revision 缺失" },
      },
      sessionId: "sess-1",
      messageId: "msg-1",
    });
    const payload = formatIpcError(err);
    assert.equal(payload.code, "SESSION_FS_ROLLBACK_VFS_RESTORE_FAILED");
    assert.equal(payload.message, "工作区无法恢复：revision 缺失");
  });

  it("SESSION_FS_ROLLBACK_REVISION_BACKFILL_REQUIRED：missingLogicalPaths 改从 details 提取", () => {
    // descriptor 走 params.descriptor 通道（同上；missingLogicalPaths 留在 params 供 details 透传）。
    const err = new AppError("SESSION_FS_ROLLBACK_REVISION_BACKFILL_REQUIRED", {
      descriptor: {
        key: "error.session_fs.rollback_revision_backfill_required",
        params: { missing_logical_paths: "/chapter-1.md, /notes/b.md" },
      },
      missingLogicalPaths: ["/chapter-1.md", "/notes/b.md"],
      sessionId: "sess-1",
      messageId: "msg-1",
    });
    const payload = formatIpcError(err);
    assert.equal(
      payload.code,
      "SESSION_FS_ROLLBACK_REVISION_BACKFILL_REQUIRED"
    );
    // descriptor 迁移后 Error.message 是英文 desc；中文经 coreT 渲染。
    assert.equal(
      payload.message,
      "回滚所需 revision 缺失，需确认使用最新内容修复：/chapter-1.md, /notes/b.md"
    );
    const descriptor = userMessageOf(err);
    assert.ok(descriptor != null);
    assert.equal(
      coreT(descriptor),
      "回滚所需 revision 缺失，需确认使用最新内容修复：/chapter-1.md, /notes/b.md"
    );
    assert.deepEqual(payload.missingLogicalPaths, [
      "/chapter-1.md",
      "/notes/b.md",
    ]);
  });

  it("TOOL_FAILED 包 VFS AppError：解包 cause 并透传 VFS_ 前缀 key", () => {
    const cause = new AppError("VFS_ALREADY_EXISTS", {
      path: "/x.md",
      detail: "Version conflict",
    });
    const err = new AppError("TOOL_FAILED", {
      toolName: "write",
      cause,
      detail: "Tool failed: write",
    });
    const payload = formatIpcError(err);
    assert.equal(payload.code, "VFS_ALREADY_EXISTS");
    assert.equal(payload.message, "名称不能重复");
  });

  it("AbortError（DOMException / RN Error 两种形态）→ IPC_ABORTED / 已取消", () => {
    // Node 侧 DOMException 形态（createAbortError 的优先分支）。
    const dom = formatIpcError(createAbortError());
    assert.equal(dom.code, "IPC_ABORTED");
    assert.equal(dom.message, "已取消");

    // Hermes 无 DOMException 时 createAbortError 退化为 Error + name='AbortError'；
    // 手搓同形对象锁住 isAbortLikeError 的识别口径。
    const rnShaped = new Error("Request aborted");
    rnShaped.name = "AbortError";
    const payload = formatIpcError(rnShaped);
    assert.equal(payload.code, "IPC_ABORTED");
    assert.equal(payload.message, "已取消");
    // 取消不是业务错误：不得落成 INFRA_UNEXPECTED_ERROR。
    assert.notEqual(payload.code, "INFRA_UNEXPECTED_ERROR");
  });

  it("AssertionError（不变量破坏）→ INFRA_UNEXPECTED_ERROR（不是 AppError 通道，T-S25）", () => {
    let thrown: unknown;
    try {
      throw new AssertionError("穷尽分支破坏");
    } catch (error) {
      thrown = error;
    }
    const payload = formatIpcError(thrown);
    assert.equal(payload.code, "INFRA_UNEXPECTED_ERROR");
    assert.equal(payload.message, "[invariant] 穷尽分支破坏");
  });

  it("AGENT_MESSAGE_EMPTY 透出自身 code 与中文文案（不再笼统落 AGENT_RUN_FAILED）", () => {
    const err = new AppError("AGENT_MESSAGE_EMPTY");
    const payload = formatIpcError(err);
    assert.equal(payload.code, "AGENT_MESSAGE_EMPTY");
    assert.equal(payload.message, "消息不能为空");
  });

  it("透出 AppError.key（勿落成 Error.name）", () => {
    const err = new AppError(
      "VFS_CHARACTER_CARD_UNRECOGNIZED",
      "无法识别为角色卡"
    );
    const payload = formatIpcError(err);
    assert.equal(payload.code, "VFS_CHARACTER_CARD_UNRECOGNIZED");
    assert.equal(payload.message, "无法识别为角色卡");
  });
});
