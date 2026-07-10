import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolError } from "../../src/errors/tool-errors.js";
import { VfsError } from "../../src/errors/vfs-errors.js";
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

  it("T-BTRB-01: error with vfsScope summary uses classified message", () => {
    const cause = new VfsError("NOT_FOUND", "Path not found: /projects/p/sessions/s/f.txt", {
      path: "/projects/p/sessions/s/f.txt",
    });
    const block = buildToolResultBlock(
      "tu4",
      {
        ok: false,
        error: new ToolError("FAILED", "Tool failed: read", { cause }),
      },
      {
        toolName: "read",
        vfsScope: { kind: "session", projectId: "p", sessionId: "s" },
      },
    );
    assert.ok(block.summary?.includes("[NOT_FOUND]"));
    assert.ok(block.summary?.includes("/f.txt"));
    assert.ok(!block.summary?.includes("/projects/"));
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

  it("BTRB-FMT-01: read/grep/glob content uses readable formatters", () => {
    const readBlock = buildToolResultBlock(
      "tu-read",
      {
        ok: true,
        output: {
          path: "/a.md",
          content: "hello",
          offset: 1,
          limit: 2000,
          totalLines: 1,
          returnedLines: 1,
          truncated: false,
        },
      },
      { toolName: "read" },
    );
    assert.equal(readBlock.content, "     1|hello");

    const grepBlock = buildToolResultBlock(
      "tu-grep",
      {
        ok: true,
        output: {
          matches: [
            { path: "/x.ts", line: 2, column: 4, excerpt: "needle" },
          ],
          total: 1,
          truncated: false,
        },
      },
      { toolName: "grep" },
    );
    assert.equal(grepBlock.content, "/x.ts:2:4: needle");

    const globBlock = buildToolResultBlock(
      "tu-glob",
      {
        ok: true,
        output: {
          paths: ["/a.ts", "/b.ts"],
          total: 2,
          truncated: false,
        },
      },
      { toolName: "glob" },
    );
    assert.equal(globBlock.content, "/a.ts\n/b.ts");
  });
});
