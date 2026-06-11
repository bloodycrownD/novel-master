import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolError } from "../../src/errors/tool-errors.js";
import {
  buildToolResultBlock,
  resolveToolResultOk,
} from "../../src/domain/tool/logic/build-tool-result-block.js";

describe("buildToolResultBlock", () => {
  it("R1: success outcome sets ok true and formats content", () => {
    const block = buildToolResultBlock(
      "tu1",
      { ok: true, output: { version: 1 } },
      { toolName: "write" },
    );
    assert.equal(block.type, "tool_result");
    assert.equal(block.toolUseId, "tu1");
    assert.equal(block.ok, true);
    assert.equal(block.content, "ok");
    assert.equal(block.summary, "ok");
  });

  it("R1: error outcome sets ok false and Error: content", () => {
    const block = buildToolResultBlock("tu2", {
      ok: false,
      error: new ToolError("NOT_FOUND", "Path not found"),
    });
    assert.equal(block.ok, false);
    assert.ok(block.content.startsWith("Error:"));
    assert.ok(block.summary?.includes("Path not found"));
  });

  it("R2: read output with terrors in body stays ok true", () => {
    const ravenSnippet =
      "Thrilled me—filled me with fantastic terrors never felt before;";
    const block = buildToolResultBlock(
      "tu3",
      {
        ok: true,
        output: {
          path: "/poem.txt",
          content: ravenSnippet,
          returnedLines: 30,
          totalLines: 30,
          truncated: false,
        },
      },
      { toolName: "read" },
    );
    assert.equal(block.ok, true);
    assert.ok(block.content.includes("terrors"));
    assert.equal(block.summary, "30 lines");
    assert.equal(resolveToolResultOk(block), true);
  });
});
