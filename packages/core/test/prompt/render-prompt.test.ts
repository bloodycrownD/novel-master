import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPromptLlmInput,
  formatPromptLlmInputForCli,
  textBlocks,
  type ChatMessage,
  type PromptBlock,
} from "@novel-master/core";

const fixedNow = new Date(2026, 4, 24, 9, 0, 0);

function message(
  role: string,
  content: string,
  seq: number,
): ChatMessage {
  return {
    id: `m${seq}`,
    sessionId: "s1",
    seq,
    role,
    content: textBlocks(content),
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
  };
}

describe("buildPromptLlmInput", () => {
  it("extracts system blocks and passes visible messages", () => {
    const blocks: PromptBlock[] = [
      { name: "s", type: "text", role: "system", content: "ctx" },
      { name: "c", type: "chat" },
      { name: "u", type: "text", role: "user", content: "ask" },
    ];
    const messages = [message("user", "{{literal}}", 1)];
    const input = buildPromptLlmInput(blocks, {
      worktreeDisplay: "WT",
      messages,
      now: fixedNow,
    });
    assert.equal(input.system, "ctx");
    assert.equal(input.messages.length, 1);
    assert.equal(input.messages[0]!.content.blocks[0]!.type, "text");
  });

  it("omits system when no system text blocks", () => {
    const blocks: PromptBlock[] = [
      { name: "c", type: "chat" },
    ];
    const input = buildPromptLlmInput(blocks, {
      worktreeDisplay: "",
      messages: [],
      now: fixedNow,
    });
    assert.equal(input.system, undefined);
  });
});

describe("formatPromptLlmInputForCli", () => {
  it("renders text + chat + text in order without macro in chat", () => {
    const blocks: PromptBlock[] = [
      { name: "s", type: "text", role: "system", content: "ctx" },
      { name: "c", type: "chat" },
      { name: "u", type: "text", role: "user", content: "ask" },
    ];
    const messages = [message("user", "{{literal}}", 1)];
    const ctx = { worktreeDisplay: "WT", messages, now: fixedNow };
    const input = buildPromptLlmInput(blocks, ctx);
    const out = formatPromptLlmInputForCli(blocks, input, ctx);
    assert.equal(out, "system: ctx\nuser: {{literal}}\nuser: ask");
  });

  it("joins two text blocks with single newline", () => {
    const blocks: PromptBlock[] = [
      { name: "a", type: "text", role: "system", content: "one" },
      { name: "b", type: "text", role: "user", content: "two" },
    ];
    const ctx = { worktreeDisplay: "", messages: [], now: fixedNow };
    const input = buildPromptLlmInput(blocks, ctx);
    const out = formatPromptLlmInputForCli(blocks, input, ctx);
    assert.equal(out, "system: one\nuser: two");
    assert.ok(!out.includes("a:"));
    assert.ok(!out.includes("b:"));
  });

  it("prefixes role only on first line of multiline content", () => {
    const blocks: PromptBlock[] = [
      { name: "m", type: "text", role: "system", content: "line1\nline2" },
    ];
    const ctx = { worktreeDisplay: "", messages: [], now: fixedNow };
    const input = buildPromptLlmInput(blocks, ctx);
    const out = formatPromptLlmInputForCli(blocks, input, ctx);
    assert.equal(out, "system: line1\nline2");
  });
});
