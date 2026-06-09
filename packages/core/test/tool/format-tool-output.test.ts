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

  it("returns ok for replace result with one replacement", () => {
    assert.equal(
      formatToolOutputForLlm({ version: 2, replacements: 1 }),
      "ok",
    );
  });

  it("summarizes multi replacement replace result", () => {
    assert.equal(
      formatToolOutputForLlm({ version: 2, replacements: 3 }),
      "ok (3 replacements)",
    );
  });

  it("returns ok for { ok: true } mutating tool results", () => {
    assert.equal(formatToolOutputForLlm({ ok: true }), "ok");
  });

  it("keeps structured read results as JSON", () => {
    const out = formatToolOutputForLlm({
      path: "/a.md",
      content: "hi",
      version: 1,
      mtimeMs: 0,
    });
    assert.ok(out.includes('"path"'));
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
