/**
 * compress-user-vfs-tool-uses 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolUseBlock } from "../../src/domain/chat/model/content-block.js";
import { compressUserVfsToolUses } from "../../src/domain/tool/logic/compress-user-vfs-tool-uses.js";

describe("compressUserVfsToolUses", () => {
  it("edit 字符串值压缩为省略号", () => {
    const input: ToolUseBlock[] = [
      {
        type: "tool_use",
        id: "tu_1",
        name: "edit",
        input: { path: "a.md", oldString: "long old", newString: "long new" },
      },
    ];
    const out = compressUserVfsToolUses(input);
    assert.equal(out[0]?.input.path, "…");
    assert.equal(out[0]?.input.oldString, "…");
    assert.equal(out[0]?.input.newString, "…");
  });

  it("write 保留 number/boolean", () => {
    const input: ToolUseBlock[] = [
      {
        type: "tool_use",
        id: "tu_2",
        name: "write",
        input: {
          path: "b.md",
          content: "body",
          options: { expectedVersion: 3, versionCheck: true },
        },
      },
    ];
    const out = compressUserVfsToolUses(input);
    const options = out[0]?.input.options as Record<string, unknown>;
    assert.equal(options.expectedVersion, 3);
    assert.equal(options.versionCheck, true);
    assert.equal(out[0]?.input.content, "…");
  });

  it("fs command 字符串压缩", () => {
    const input: ToolUseBlock[] = [
      {
        type: "tool_use",
        id: "tu_3",
        name: "fs",
        input: { command: "rm draft.md" },
      },
    ];
    const out = compressUserVfsToolUses(input);
    assert.equal(out[0]?.input.command, "…");
  });
});
