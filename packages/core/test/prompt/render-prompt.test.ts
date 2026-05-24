import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  renderPromptToText,
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
    content: { content },
    provider: null,
    raw: null,
    createdAtMs: seq,
  };
}

describe("renderPromptToText", () => {
  it("renders text + chat + text in order without macro in chat", () => {
    const blocks: PromptBlock[] = [
      {
        name: "s",
        type: "text",
        role: "system",
        content: "ctx",
      },
      { name: "c", type: "chat" },
      {
        name: "u",
        type: "text",
        role: "user",
        content: "ask",
      },
    ];
    const messages = [message("user", "{{literal}}", 1)];
    const out = renderPromptToText(blocks, {
      worktreeDisplay: "WT",
      messages,
      now: fixedNow,
    });
    assert.equal(out, "system: ctx\nuser: {{literal}}\nuser: ask");
  });

  it("joins two text blocks with single newline", () => {
    const blocks: PromptBlock[] = [
      {
        name: "a",
        type: "text",
        role: "system",
        content: "one",
      },
      {
        name: "b",
        type: "text",
        role: "user",
        content: "two",
      },
    ];
    const out = renderPromptToText(blocks, {
      worktreeDisplay: "",
      messages: [],
      now: fixedNow,
    });
    assert.equal(out, "system: one\nuser: two");
    assert.ok(!out.includes("a:"));
    assert.ok(!out.includes("b:"));
  });

  it("prefixes role only on first line of multiline content", () => {
    const blocks: PromptBlock[] = [
      {
        name: "m",
        type: "text",
        role: "system",
        content: "line1\nline2",
      },
    ];
    const out = renderPromptToText(blocks, {
      worktreeDisplay: "",
      messages: [],
      now: fixedNow,
    });
    assert.equal(out, "system: line1\nline2");
  });
});
