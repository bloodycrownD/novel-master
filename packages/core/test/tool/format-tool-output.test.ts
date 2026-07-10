import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VfsError, vfsReplaceNotFound } from "../../src/errors/vfs-errors.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import {
  formatToolErrorForLlm,
  formatToolOutputForLlm,
  formatToolResultContentForDisplay,
} from "../../src/domain/tool/logic/format-tool-output.js";
import type { VfsScope } from "../../src/domain/vfs/logic/vfs-path-mapper.js";

const sessionScope: VfsScope = {
  kind: "session",
  projectId: "proj-1",
  sessionId: "sess-1",
};

const physicalPath = "/projects/proj-1/sessions/sess-1/missing.txt";

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

  it("FMT-READ-03: formats truncated read with line numbers and nextOffset hint", () => {
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
    assert.equal(out.startsWith("     1|line-1"), true);
    assert.ok(!out.includes('"path"'));
    assert.ok(out.includes("Continue with offset=2001"));
    assert.ok(out.includes("Output truncated."));
  });

  it("FMT-READ-01: non-truncated read uses line numbers, not JSON", () => {
    const out = formatToolOutputForLlm({
      path: "/a.md",
      content: "alpha\nbeta",
      version: 1,
      mtimeMs: 0,
      offset: 1,
      limit: 2000,
      totalLines: 2,
      returnedLines: 2,
      truncated: false,
    });
    assert.equal(out, "     1|alpha\n     2|beta");
    assert.ok(!out.includes("{"));
  });

  it("FMT-READ-02: offset=10 starts line numbers at 10", () => {
    const out = formatToolOutputForLlm({
      path: "/a.md",
      content: "line-ten\nline-eleven",
      version: 1,
      mtimeMs: 0,
      offset: 10,
      limit: 2000,
      totalLines: 20,
      returnedLines: 2,
      truncated: false,
    });
    assert.equal(out, "    10|line-ten\n    11|line-eleven");
  });

  it("FMT-GREP-01: grep matches as path:line:column per line", () => {
    const out = formatToolOutputForLlm({
      matches: [
        { path: "/src/a.ts", line: 3, column: 5, excerpt: "const x = 1;" },
        { path: "/src/b.ts", line: 10, column: 1, excerpt: "export {}" },
      ],
      total: 2,
      truncated: false,
    });
    assert.equal(
      out,
      "/src/a.ts:3:5: const x = 1;\n/src/b.ts:10:1: export {}",
    );
    assert.ok(!out.includes('"matches"'));
  });

  it("FMT-GREP-01: truncated grep uses line format plus hint", () => {
    const out = formatToolOutputForLlm({
      matches: [{ path: "/a.ts", line: 1, column: 1, excerpt: "foo" }],
      total: 50,
      truncated: true,
    });
    assert.equal(out.startsWith("/a.ts:1:1: foo"), true);
    assert.ok(out.includes("Output truncated (49 more omitted; total 50)."));
    assert.ok(!out.includes('"total"'));
  });

  it("FMT-GLOB-01: glob paths one per line", () => {
    const out = formatToolOutputForLlm({
      paths: ["/src/a.ts", "/src/b.ts"],
      total: 2,
      truncated: false,
    });
    assert.equal(out, "/src/a.ts\n/src/b.ts");
    assert.ok(!out.includes('"paths"'));
  });

  it("FMT-GLOB-01: truncated glob uses line format plus hint", () => {
    const out = formatToolOutputForLlm({
      paths: ["/a.ts"],
      total: 10,
      truncated: true,
    });
    assert.equal(out.startsWith("/a.ts"), true);
    assert.ok(out.includes("Output truncated (9 more omitted; total 10)."));
    assert.ok(!out.includes('"total"'));
  });

  it("FMT-REG-01: edit/write still return ok", () => {
    assert.equal(formatToolOutputForLlm({ version: 1 }), "ok");
    assert.equal(
      formatToolOutputForLlm({ version: 2, replacements: 2 }),
      "ok",
    );
    assert.equal(formatToolOutputForLlm({ ok: true }), "ok");
  });

  it("FMT-REG-02: fs ls tab format unchanged", () => {
    const out = formatToolOutputForLlm({
      entries: [{ path: "/a", kind: "file" }],
      total: 100,
      truncated: true,
      omitted: 99,
    });
    assert.ok(out.includes("/a\tfile"));
    assert.ok(out.includes("truncated"));
  });

  it("FMT-REG-03: chat_grep output stays JSON, not grep formatter", () => {
    const input = {
      matches: [
        {
          messageId: "msg-1",
          seq: 2,
          role: "user",
          line: 1,
          column: 3,
          excerpt: "hello",
          hidden: false,
        },
      ],
      total: 1,
      truncated: false,
    };
    const out = formatToolOutputForLlm(input);
    assert.ok(out.includes('"messageId"'));
    assert.ok(out.includes('"seq"'));
    assert.ok(!out.includes("msg-1:1:3:"));
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
      "Error: [NOT_FOUND] Path not found: /missing",
    );
  });

  it("T-ERR-01: session scope maps physical path to logical", () => {
    const cause = new VfsError("NOT_FOUND", `Path not found: ${physicalPath}`, {
      path: physicalPath,
    });
    const err = new ToolError("FAILED", "Tool failed: read", {
      toolName: "read",
      cause,
    });
    const content = formatToolErrorForLlm(err, { vfsScope: sessionScope });
    assert.ok(content.includes("[NOT_FOUND]"));
    assert.ok(content.includes("/missing.txt"));
    assert.ok(!content.includes("/projects/"));
    assert.ok(!content.includes("/sessions/"));
  });

  it("T-ERR-02: CONFLICT includes category and versions", () => {
    const cause = new VfsError(
      "CONFLICT",
      `Version conflict for ${physicalPath}: expected 1, actual 2`,
      {
        path: physicalPath,
        expectedVersion: 1,
        actualVersion: 2,
      },
    );
    const content = formatToolErrorForLlm(
      new ToolError("FAILED", "Tool failed: write", { cause }),
      { vfsScope: sessionScope },
    );
    assert.ok(content.includes("[CONFLICT]"));
    assert.ok(content.includes("expected 1, actual 2"));
  });

  it("T-ERR-03: NOT_FOUND category", () => {
    const cause = new VfsError("NOT_FOUND", `Path not found: ${physicalPath}`, {
      path: physicalPath,
    });
    const content = formatToolErrorForLlm(
      new ToolError("FAILED", "x", { cause }),
      { vfsScope: sessionScope },
    );
    assert.ok(content.includes("[NOT_FOUND]"));
  });

  it("T-ERR-04: REPLACE_NOT_FOUND includes LCS snippet", () => {
    const cause = vfsReplaceNotFound(physicalPath, {
      oldStringLength: 10,
      longestCommonSubstring: "function hello()",
      lcsLength: 16,
      lcsOccurrences: 1,
    });
    const content = formatToolErrorForLlm(
      new ToolError("FAILED", "x", { cause }),
      { vfsScope: sessionScope },
    );
    assert.ok(content.includes("[REPLACE_NOT_FOUND]"));
    assert.ok(content.includes("function hello()"));
    assert.ok(content.includes("occurrences=1"));
  });

  it("T-ERR-05: short LCS suggests re-read", () => {
    const cause = vfsReplaceNotFound(physicalPath, {
      oldStringLength: 10,
      longestCommonSubstring: "ab",
      lcsLength: 2,
      lcsOccurrences: 1,
    });
    const content = formatToolErrorForLlm(
      new ToolError("FAILED", "x", { cause }),
      { vfsScope: sessionScope },
    );
    assert.ok(content.includes("Almost no matching text"));
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
