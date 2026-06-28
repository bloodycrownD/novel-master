import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  sessionFsRollbackNoCheckpoint,
  sessionFsRollbackRevisionBackfillRequired,
  sessionFsRollbackVfsRestoreFailed,
} from "../../../packages/core/src/errors/session-fs-errors.js";
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
    assert.match(payload.message, /revision 缺失/);
    assert.deepEqual(payload.missingLogicalPaths, [
      "/chapter-1.md",
      "/notes/b.md",
    ]);
  });
});
