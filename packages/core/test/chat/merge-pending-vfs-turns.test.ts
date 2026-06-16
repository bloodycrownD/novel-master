/**
 * merge-pending-vfs-turns 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergePendingVfsTurns } from "../../src/domain/chat/logic/merge-pending-vfs-turns.js";

describe("mergePendingVfsTurns", () => {
  it("空队列返回空结果", () => {
    const merged = mergePendingVfsTurns([]);
    assert.equal(merged.actionsXml, "");
    assert.equal(merged.toolUses.length, 0);
    assert.equal(merged.toolResults.length, 0);
  });

  it("3 次 pending FIFO 合并为有序 tool_use 与 ok result", () => {
    const pending = [
      {
        actionXml: '<user-vfs-action kind="delete" path="a.md" />',
        tools: [{ id: "tu_1", name: "fs" }],
        createdAtMs: 1,
      },
      {
        actionXml: '<user-vfs-action kind="mkdir" path="b/" />',
        tools: [{ id: "tu_2", name: "fs" }],
        createdAtMs: 2,
      },
      {
        actionXml:
          '<user-vfs-action kind="save" path="c.md" method="edit" hunks="1">' +
          '<edit-hunk index="1"><old>x</old><new>y</new></edit-hunk></user-vfs-action>',
        tools: [{ id: "tu_3", name: "edit" }],
        createdAtMs: 3,
      },
    ];
    const merged = mergePendingVfsTurns(pending);
    assert.equal(merged.toolUses.length, 3);
    assert.equal(merged.toolResults.length, 3);
    assert.equal(merged.toolUses[0]?.id, "tu_1");
    assert.equal(merged.toolUses[1]?.id, "tu_2");
    assert.equal(merged.toolUses[2]?.id, "tu_3");
    assert.equal(merged.toolResults[0]?.content, "ok");
    assert.equal(merged.toolResults[1]?.toolUseId, "tu_2");
    assert.ok(merged.actionsXml.includes("delete"));
    assert.ok(merged.actionsXml.includes("mkdir"));
    assert.ok(merged.toolUses[2]?.input.oldString, "…");
  });
});
