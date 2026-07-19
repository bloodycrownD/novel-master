/**
 * merge-pending-vfs-turns 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergePendingVfsTurns } from "../../src/domain/chat/logic/merge-pending-vfs-turns.js";

describe("mergePendingVfsTurns", () => {
  it("空队列返回空 actionsXml", () => {
    const merged = mergePendingVfsTurns([]);
    assert.equal(merged.actionsXml, "");
  });

  it("3 次 pending FIFO 合并为有序 actionsXml", () => {
    const pending = [
      {
        actionXml: '<action name="delete">\n{"path":"a.md"}\n</action>',
        tools: [{ id: "tu_1", name: "fs" }],
        createdAtMs: 1,
      },
      {
        actionXml: '<action name="mkdir">\n{"path":"b/"}\n</action>',
        tools: [{ id: "tu_2", name: "fs" }],
        createdAtMs: 2,
      },
      {
        actionXml:
          '<action name="edit">\n{"path":"c.md","oldString":"x","newString":"y"}\n</action>',
        tools: [{ id: "tu_3", name: "edit" }],
        createdAtMs: 3,
      },
    ];
    const merged = mergePendingVfsTurns(pending);
    assert.ok(merged.actionsXml.includes("delete"));
    assert.ok(merged.actionsXml.includes("mkdir"));
    assert.ok(merged.actionsXml.includes("edit"));
    assert.equal(merged.actionsXml.match(/<action\b/g)?.length, 3);
  });
});
