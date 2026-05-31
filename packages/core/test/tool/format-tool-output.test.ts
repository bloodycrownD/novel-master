import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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
