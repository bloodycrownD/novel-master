import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPromptLlmInputForCli,
  serializePromptLlmInput,
  textBlocks,
  type ChatMessage,
  type PromptBlock,
} from "@novel-master/core";

function message(role: string, content: string, seq: number): ChatMessage {
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

describe("prompt assembly parity", () => {
  it("T2: serializePromptLlmInput equals formatPromptLlmInputForCli", () => {
    const blocks: PromptBlock[] = [
      { name: "s", type: "text", role: "system", content: "You are helpful." },
      { name: "ctx", type: "text", role: "user", content: "{{.worktree}}" },
      { name: "c", type: "chat" },
    ];
    const ctx = {
      worktreeDisplay: "WORKTREE_BODY",
      filetreeDisplay: "TREE",
      messages: [message("user", "hello", 1), message("assistant", "hi", 2)],
    };
    const formatted = formatPromptLlmInputForCli(blocks, ctx);
    const serialized = serializePromptLlmInput(blocks, ctx);
    assert.equal(serialized, formatted);
  });

  it("T3: system+chat only matches writer-agent shape", () => {
    const blocks: PromptBlock[] = [
      { name: "s", type: "text", role: "system", content: "Write stories." },
      { name: "c", type: "chat" },
    ];
    const ctx = {
      worktreeDisplay: "",
      filetreeDisplay: "",
      messages: [message("user", "go", 1)],
    };
    const out = serializePromptLlmInput(blocks, ctx);
    assert.match(out, /^system: Write stories\./);
    assert.match(out, /user: go/);
    assert.ok(!out.includes("\n\n"));
  });

  it("T4: hide shortens chat portion but worktree template remains", () => {
    const worktree = "W".repeat(10_000);
    const blocks: PromptBlock[] = [
      { name: "ctx", type: "text", role: "user", content: "{{.worktree}}" },
      { name: "c", type: "chat" },
    ];
    const fullCtx = {
      worktreeDisplay: worktree,
      filetreeDisplay: "",
      messages: [
        message("user", "one", 1),
        message("assistant", "two", 2),
        message("user", "three", 3),
      ],
    };
    const hiddenCtx = {
      ...fullCtx,
      messages: [message("user", "one", 1)],
    };
    const full = serializePromptLlmInput(blocks, fullCtx);
    const hidden = serializePromptLlmInput(blocks, hiddenCtx);
    const drop = full.length - hidden.length;
    assert.ok(full.includes(worktree));
    assert.ok(hidden.includes(worktree));
    assert.ok(drop > 0);
    assert.ok(drop < worktree.length);
  });
});
