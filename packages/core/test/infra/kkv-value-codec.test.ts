import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatBoolean, parseBoolean } from "../../src/infra/kkv-value-codec.js";

describe("kkv-value-codec", () => {
  it("parses \"true\" / \"false\"", () => {
    const t = parseBoolean("true");
    if (!t.ok) {
      assert.fail("expected ok");
    }
    assert.equal(t.value, true);
    const f = parseBoolean("false");
    if (!f.ok) {
      assert.fail("expected ok");
    }
    assert.equal(f.value, false);
  });

  it("returns Err and preserves the original message", () => {
    const r = parseBoolean("yes");
    if (r.ok) {
      assert.fail("expected Err");
    }
    assert.equal(r.error.message, "Expected boolean string, got: yes");
  });

  it("formats booleans for KKV storage", () => {
    assert.equal(formatBoolean(true), "true");
    assert.equal(formatBoolean(false), "false");
  });
});
