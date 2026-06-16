/**
 * Pure unit tests for rollback turn anchor resolution.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ChatMessage } from "@novel-master/core/chat";
import { resolveRollbackAnchorMessage } from "../../src/domain/message-checkpoint/logic/resolve-rollback-anchor.js";

function msg(
  id: string,
  role: string,
  blocks: ChatMessage["content"]["blocks"],
  seq: number,
): ChatMessage {
  return {
    id,
    sessionId: "s1",
    seq,
    role,
    content: { blocks },
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
  };
}

describe("resolveRollbackAnchorMessage", () => {
  it("maps assistant with paired tool_result to tool_result message", () => {
    const messages = [
      msg("a1", "assistant", [
        { type: "tool_use", id: "tu1", name: "read", input: {} },
      ], 1),
      msg("u1", "user", [
        { type: "tool_result", toolUseId: "tu1", content: "ok" },
      ], 2),
    ];
    const effective = resolveRollbackAnchorMessage(messages, "a1");
    assert.equal(effective?.id, "u1");
  });

  it("keeps user anchor unchanged", () => {
    const messages = [
      msg("u1", "user", [{ type: "text", text: "hi" }], 1),
      msg("a1", "assistant", [{ type: "text", text: "hello" }], 2),
    ];
    const effective = resolveRollbackAnchorMessage(messages, "u1");
    assert.equal(effective?.id, "u1");
  });

  it("keeps text-only assistant anchor unchanged", () => {
    const messages = [
      msg("a1", "assistant", [{ type: "text", text: "hello" }], 1),
    ];
    const effective = resolveRollbackAnchorMessage(messages, "a1");
    assert.equal(effective?.id, "a1");
  });

  it("keeps assistant without paired tool_result unchanged", () => {
    const messages = [
      msg("a1", "assistant", [
        { type: "tool_use", id: "tu1", name: "read", input: {} },
      ], 1),
    ];
    const effective = resolveRollbackAnchorMessage(messages, "a1");
    assert.equal(effective?.id, "a1");
  });
});
