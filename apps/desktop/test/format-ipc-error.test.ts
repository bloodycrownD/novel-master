import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolError } from "@novel-master/core";
import { AppError, VfsError } from "@novel-master/core/vfs";
import { AgentTurnError } from "@novel-master/core/agent";
// 走公开子入口而非 core src：src 的 `@/` 别名只有 core-dist hook 覆盖，
// 测试直接加载 src 会在 `@/i18n/*` 上解析失败（迁移后新增的运行时 import）。
import {
  sessionFsRollbackNoCheckpoint,
  sessionFsRollbackRevisionBackfillRequired,
  sessionFsRollbackVfsRestoreFailed,
} from "@novel-master/core/session-fs";
import { userMessageOf } from "@novel-master/core/i18n";
import { coreT } from "../shared/logic/core-i18n.js";
import { formatIpcError } from "../src/main/ipc/format-ipc-error.js";

describe("formatIpcError", () => {
  it("maps sessionFsRollbackNoCheckpoint to ROLLBACK_NO_CHECKPOINT", () => {
    const err = sessionFsRollbackNoCheckpoint("msg-1", "sess-1");
    const payload = formatIpcError(err);
    assert.equal(payload.code, "ROLLBACK_NO_CHECKPOINT");
    assert.match(payload.message, /该消息无回滚点/);
  });

  it("maps sessionFsRollbackVfsRestoreFailed to ROLLBACK_VFS_RESTORE_FAILED", () => {
    const err = sessionFsRollbackVfsRestoreFailed("工作区无法恢复：revision 缺失", {
      sessionId: "sess-1",
      messageId: "msg-1",
    });
    const payload = formatIpcError(err);
    assert.equal(payload.code, "ROLLBACK_VFS_RESTORE_FAILED");
    assert.match(payload.message, /工作区无法恢复/);
  });

  it("maps sessionFsRollbackRevisionBackfillRequired to ROLLBACK_REVISION_BACKFILL_REQUIRED", () => {
    const err = sessionFsRollbackRevisionBackfillRequired(
      ["/chapter-1.md", "/notes/b.md"],
      {
      sessionId: "sess-1",
      messageId: "msg-1",
    },
    );
    const payload = formatIpcError(err);
    assert.equal(payload.code, "ROLLBACK_REVISION_BACKFILL_REQUIRED");
    // descriptor 迁移后 Error.message 是 key 原文；中文经 coreT 渲染。
    assert.equal(
      payload.message,
      "error.session_fs.rollback_revision_backfill_required",
    );
    const descriptor = userMessageOf(err);
    assert.ok(descriptor != null);
    assert.equal(
      coreT(descriptor),
      "回滚所需 revision 缺失，需确认使用最新内容修复：/chapter-1.md, /notes/b.md",
    );
    assert.deepEqual(payload.missingLogicalPaths, [
      "/chapter-1.md",
      "/notes/b.md",
    ]);
  });

  it("unwraps VfsError cause from ToolError", () => {
    const cause = new VfsError("CONFLICT", "Version conflict");
    const err = new ToolError("FAILED", "Tool failed: write", {
      toolName: "write",
      cause,
    });
    const payload = formatIpcError(err);
    assert.equal(payload.code, "CONFLICT");
    assert.equal(payload.message, "Version conflict");
  });

  it("maps AgentTurnError to AGENT_RUN_ERROR", () => {
    const err = new AgentTurnError("消息不能为空");
    const payload = formatIpcError(err);
    assert.equal(payload.code, "AGENT_RUN_ERROR");
    assert.equal(payload.message, "消息不能为空");
  });

  it("透出 AppError.key（勿落成 Error.name）", () => {
    const err = new AppError(
      "VFS_CHARACTER_CARD_UNRECOGNIZED",
      "无法识别为角色卡",
    );
    const payload = formatIpcError(err);
    assert.equal(payload.code, "VFS_CHARACTER_CARD_UNRECOGNIZED");
    assert.equal(payload.message, "无法识别为角色卡");
  });
});
