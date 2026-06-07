import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessionFsRollbackNoCheckpoint } from "../../../packages/core/src/errors/session-fs-errors.js";
import { formatIpcError } from "../src/main/ipc/format-ipc-error.js";

describe("formatIpcError", () => {
  it("maps sessionFsRollbackNoCheckpoint to ROLLBACK_NO_CHECKPOINT", () => {
    const err = sessionFsRollbackNoCheckpoint("msg-1", "sess-1");
    const payload = formatIpcError(err);
    assert.equal(payload.code, "ROLLBACK_NO_CHECKPOINT");
    assert.match(payload.message, /该消息无回滚点/);
  });
});
