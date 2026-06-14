import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VfsError } from "../../src/errors/vfs-errors.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import {
  formatToolErrorForLlm,
  formatToolOutputForLlm,
  formatToolResultContentForDisplay,
} from "../../src/domain/tool/logic/format-tool-output.js";

describe("formatToolOutputForLlm", () => {
  it("returns ok for version-only write result", () => {
    assert.equal(formatToolOutputForLlm({ version: 1 }), "ok");
  });

  it("T10: returns ok for edit result with one replacement", () => {
    assert.equal(
      formatToolOutputForLlm({ version: 2, replacements: 1 }),
      "ok",
    );
  });

  it("T10: multi replacement edit result returns ok", () => {
    assert.equal(
      formatToolOutputForLlm({ version: 2, replacements: 3 }),
      "ok",
    );
  });

  it("returns ok for { ok: true } fs mutating results", () => {
    assert.equal(formatToolOutputForLlm({ ok: true }), "ok");
  });

  it("T10: formats truncated read with nextOffset hint", () => {
    const out = formatToolOutputForLlm({
      path: "/a.md",
      content: "line-1",
      version: 1,
      mtimeMs: 0,
      offset: 1,
      limit: 2000,
      totalLines: 5000,
      returnedLines: 2000,
      truncated: true,
      nextOffset: 2001,
    });
    assert.ok(out.includes("line-1"));
    assert.ok(out.includes("Continue with offset=2001"));
  });

  it("T10: formats fs ls truncated output", () => {
    const out = formatToolOutputForLlm({
      entries: [{ path: "/a", kind: "file" }],
      total: 100,
      truncated: true,
      omitted: 99,
    });
    assert.ok(out.includes("/a\tfile"));
    assert.ok(out.includes("truncated"));
  });
});

describe("formatToolErrorForLlm", () => {
  it("unwraps VfsError cause from ToolError", () => {
    const cause = new VfsError("NOT_FOUND", "Path not found: /missing", {
      path: "/missing",
    });
    const err = new ToolError("FAILED", "Tool failed: read", {
      toolName: "read",
      cause,
    });
    assert.equal(
      formatToolErrorForLlm(err),
      "Error: Path not found: /missing",
    );
  });

  it("summarizes INVALID_ARGUMENT zod issues", () => {
    const err = new ToolError("INVALID_ARGUMENT", "Invalid input for tool: write", {
      toolName: "write",
      details: {
        issues: [{ code: "custom", path: ["path"], message: "Required" }],
      },
    });
    assert.equal(formatToolErrorForLlm(err), "Error: Required");
  });

  it("falls back to ToolError message without cause", () => {
    const err = new ToolError("NOT_FOUND", "Tool not registered: missing", {
      toolName: "missing",
    });
    assert.equal(
      formatToolErrorForLlm(err),
      "Error: Tool not registered: missing",
    );
  });
});

describe("formatToolResultContentForDisplay", () => {
  it("prettifies legacy JSON version payloads", () => {
    assert.equal(formatToolResultContentForDisplay('{\n  "version": 1\n}'), "ok");
  });

  it("preserves error strings", () => {
    assert.equal(
      formatToolResultContentForDisplay("Error: not found"),
      "Error: not found",
    );
  });
});
