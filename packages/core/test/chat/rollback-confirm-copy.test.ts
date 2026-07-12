import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRollbackConfirmMessage } from "@novel-master/core/chat";

describe("resolveRollbackConfirmMessage", () => {
  it("undo_send primary 含「及之后」", () => {
    const message = resolveRollbackConfirmMessage("undo_send", "primary");
    assert.match(message, /及之后/);
    assert.match(message, /撤销相关文件修改/);
  });

  it("rewind primary 含「之后」但不含「及之后」", () => {
    const message = resolveRollbackConfirmMessage("rewind", "primary");
    assert.match(message, /之后/);
    assert.doesNotMatch(message, /及之后/);
  });

  it("undo_send degraded 含「及之后」", () => {
    const message = resolveRollbackConfirmMessage("undo_send", "degraded");
    assert.match(message, /及之后/);
    assert.match(message, /工作区文件将保持现状/);
  });

  it("rewind degraded 不含「及之后」", () => {
    const message = resolveRollbackConfirmMessage("rewind", "degraded");
    assert.doesNotMatch(message, /及之后/);
  });

  it("backfill undo_send 末句为发送前状态", () => {
    const message = resolveRollbackConfirmMessage("undo_send", "backfill", {
      missingPaths: ["/a.md"],
    });
    assert.match(message, /回滚至发送前状态/);
    assert.doesNotMatch(message, /回滚至锚点/);
  });

  it("backfill rewind 末句为锚点", () => {
    const message = resolveRollbackConfirmMessage("rewind", "backfill", {
      missingPaths: ["/a.md"],
    });
    assert.match(message, /回滚至锚点/);
  });
});
