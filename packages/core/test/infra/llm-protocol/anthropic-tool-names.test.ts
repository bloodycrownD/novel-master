import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  AnthropicToolNames  } from "../../../src/infra/llm-protocol/logic/anthropic-tool-names.js";

describe("anthropic tool name wire encoding", () => {
  it("leaves wire-safe names unchanged", () => {
    assert.equal(AnthropicToolNames.toWireToolName("read"), "read");
    assert.equal(AnthropicToolNames.toWireToolName("vfs_read"), "vfs_read");
  });

  it("replaces dots with underscores", () => {
    assert.equal(AnthropicToolNames.toWireToolName("foo.bar"), "foo_bar");
  });

  it("detects when encoding is needed", () => {
    assert.equal(AnthropicToolNames.toolsNeedWireEncoding(["foo.bar"]), true);
    assert.equal(AnthropicToolNames.toolsNeedWireEncoding(["read"]), false);
  });

  it("round-trips canonical names", () => {
    const wire = AnthropicToolNames.createWire(["foo.bar", "read"]);
    assert.equal(wire.toWire("foo.bar"), "foo_bar");
    assert.equal(wire.fromWire("foo_bar"), "foo.bar");
    assert.equal(wire.fromWire("read"), "read");
  });
});
