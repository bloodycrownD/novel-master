/**
 * user-vfs-pending.schema 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  userVfsPendingEntrySchema,
  userVfsPendingQueueSchema,
} from "../../src/domain/chat/model/user-vfs-pending.schema.js";

describe("userVfsPendingQueueSchema", () => {
  it("合法 JSON round-trip", () => {
    const raw = [
      {
        actionXml: '<action name="delete">\n{"path":"a.md"}\n</action>',
        tools: [{ id: "tu_1", name: "fs" }],
        createdAtMs: 1710000000000,
      },
    ];
    const parsed = userVfsPendingQueueSchema.parse(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.tools[0]?.id, "tu_1");
  });

  it("缺 actionXml 拒绝", () => {
    assert.throws(() =>
      userVfsPendingEntrySchema.parse({
        tools: [{ id: "tu_1", name: "fs" }],
        createdAtMs: 1,
      }),
    );
  });

  it("缺 tools[].id 拒绝", () => {
    assert.throws(() =>
      userVfsPendingEntrySchema.parse({
        actionXml: '<action name="delete">\n{"path":"/x"}\n</action>',
        tools: [{ name: "fs" }],
        createdAtMs: 1,
      }),
    );
  });
});
