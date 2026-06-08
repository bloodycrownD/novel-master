import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anthropicToolsNeedWireEncoding,
  createAnthropicToolNameWire,
  toAnthropicWireToolName,
} from "../../../src/infra/llm-protocol/logic/anthropic-tool-names.js";

describe("anthropic tool name wire encoding", () => {
  it("leaves wire-safe names unchanged", () => {
    assert.equal(toAnthropicWireToolName("read"), "read");
    assert.equal(toAnthropicWireToolName("vfs_read"), "vfs_read");
  });

  it("replaces dots with underscores", () => {
    assert.equal(toAnthropicWireToolName("foo.bar"), "foo_bar");
  });

  it("detects when encoding is needed", () => {
    assert.equal(anthropicToolsNeedWireEncoding(["foo.bar"]), true);
    assert.equal(anthropicToolsNeedWireEncoding(["read"]), false);
  });

  it("round-trips canonical names", () => {
    const wire = createAnthropicToolNameWire(["foo.bar", "read"]);
    assert.equal(wire.toWire("foo.bar"), "foo_bar");
    assert.equal(wire.fromWire("foo_bar"), "foo.bar");
    assert.equal(wire.fromWire("read"), "read");
  });
});
