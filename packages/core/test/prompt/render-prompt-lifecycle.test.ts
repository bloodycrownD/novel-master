import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPromptAssembly,
  buildPromptLlmInput,
  formatPromptLlmInputForCli,
  messageBodyText,
  textBlocks,
  type ChatMessage,
  type PromptBlock,
} from "@novel-master/core";

const fixedNow = new Date(2026, 4, 24, 9, 0, 0);

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

const ctx = {
  worktreeDisplay: "",
  filetreeDisplay: "",
  messages: [message("user", "hi", 1)],
  now: fixedNow,
};

describe("prompt block lifecycle rendering", () => {
  const blocks: PromptBlock[] = [
    { name: "kick", type: "text", role: "user", content: "继续", lifecycle: "once" },
    { name: "c", type: "chat" },
  ];

  it("L6: once user block included at step 0 only", () => {
    const step0 = buildPromptLlmInput(blocks, ctx, { agentStepIndex: 0 });
    assert.equal(step0.messages.length, 2);
    assert.equal(step0.messages[0]!.id, "prompt:kick");

    const step1 = buildPromptLlmInput(blocks, ctx, { agentStepIndex: 1 });
    assert.equal(step1.messages.length, 1);
    assert.equal(step1.messages[0]!.id, "m1");
  });

  it("L7: always user block included at step 0 and 1", () => {
    const alwaysBlocks: PromptBlock[] = [
      { name: "ctx", type: "text", role: "user", content: "snap" },
      { name: "c", type: "chat" },
    ];
    for (const step of [0, 1]) {
      const input = buildPromptLlmInput(alwaysBlocks, ctx, { agentStepIndex: step });
      assert.equal(input.messages.length, 2);
      assert.equal(input.messages[0]!.id, "prompt:ctx");
    }
  });

  it("L8: assembly segment count matches llm input at step 1", () => {
    const assembly = buildPromptAssembly(blocks, ctx, { agentStepIndex: 1 });
    const input = buildPromptLlmInput(blocks, ctx, { agentStepIndex: 1 });
    assert.equal(assembly.length, 1);
    assert.equal(input.messages.length, 1);
    assert.equal(assembly[0]!.id, "chat-m1-0");
  });

  it("L9: default options equal step 0", () => {
    const explicit = buildPromptLlmInput(blocks, ctx, { agentStepIndex: 0 });
    const implicit = buildPromptLlmInput(blocks, ctx);
    assert.equal(explicit.messages.length, implicit.messages.length);
    assert.equal(messageBodyText(explicit.messages[0]!), "继续");
  });

  it("system blocks ignore lifecycle filtering", () => {
    const systemBlocks: PromptBlock[] = [
      {
        name: "s",
        type: "text",
        role: "system",
        content: "rules",
      },
      { name: "c", type: "chat" },
    ];
    const step1 = buildPromptLlmInput(systemBlocks, ctx, { agentStepIndex: 1 });
    assert.equal(step1.system, "rules");
  });

  it("formatPromptLlmInputForCli omits once block at step 1", () => {
    const out = formatPromptLlmInputForCli(blocks, ctx, { agentStepIndex: 1 });
    assert.equal(out, "user: hi");
    assert.ok(!out.includes("继续"));
  });
});
