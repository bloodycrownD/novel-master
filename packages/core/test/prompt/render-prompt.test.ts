import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPromptAssemblyFromLayout,
  buildPromptLlmInputFromLayout,
  buildPromptPreviewSegmentsFromLayout,
  formatPromptLlmInputForCliFromLayout,
  messageBodyText,
  textBlocks,
  type AgentPromptLayout,
  type ChatMessage,
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

const sampleLayout: AgentPromptLayout = {
  system: "ctx",
  persist: [{ name: "u", type: "text", role: "user", content: "ask" }],
  dynamic: [],
};

describe("buildPromptLlmInputFromLayout", () => {
  it("extracts system field, persist synthetic messages, and chat", async () => {
    const messages = [message("user", "{{literal}}", 1)];
    const input = await buildPromptLlmInputFromLayout(sampleLayout, {
      worktreeDisplay: "WT",
      messages,
      now: fixedNow,
    });
    assert.equal(input.system, "ctx");
    assert.equal(input.messages.length, 2);
    assert.equal(input.messages[0]!.id, "prompt:u");
    assert.equal(input.messages[1]!.id, "m1");
    assert.equal(messageBodyText(input.messages[0]!), "ask");
  });

  it("worktree persist block becomes synthetic user message", async () => {
    const layout: AgentPromptLayout = {
      persist: [
        { name: "canon", type: "worktree" },
      ],
      dynamic: [],
    };
    const input = await buildPromptLlmInputFromLayout(layout, {
      worktreeDisplay: "WT",
      messages: [message("user", "hi", 1)],
      now: fixedNow,
    });
    assert.equal(input.messages[0]!.id, "prompt:worktree:canon");
    assert.equal(messageBodyText(input.messages[0]!), "WT");
  });
});

describe("buildPromptPreviewSegmentsFromLayout", () => {
  it("segments join to the same text as formatPromptLlmInputForCliFromLayout", async () => {
    const messages = [message("user", "{{literal}}", 1)];
    const ctx = { worktreeDisplay: "WT", messages, now: fixedNow };
    const segments = await buildPromptPreviewSegmentsFromLayout(sampleLayout, ctx);
    const joined = segments
      .map((s) => {
        const trimmed = s.body.replace(/\r\n/g, "\n");
        if (trimmed === "") {
          return `${s.role}: `;
        }
        const lines = trimmed.split("\n");
        if (lines.length === 1) {
          return `${s.role}: ${lines[0]}`;
        }
        return `${s.role}: ${lines[0]}\n${lines.slice(1).join("\n")}`;
      })
      .join("\n");
    assert.equal(
      joined,
      await formatPromptLlmInputForCliFromLayout(sampleLayout, ctx),
    );
  });
});

describe("formatPromptLlmInputForCliFromLayout", () => {
  it("renders system + persist + chat in order", async () => {
    const messages = [message("user", "{{literal}}", 1)];
    const out = await formatPromptLlmInputForCliFromLayout(sampleLayout, {
      worktreeDisplay: "WT",
      messages,
      now: fixedNow,
    });
    assert.equal(out, "system: ctx\nuser: ask\nuser: {{literal}}");
  });
});

describe("buildPromptAssemblyFromLayout", () => {
  it("includes system segment first", async () => {
    const segments = await buildPromptAssemblyFromLayout(sampleLayout, {
      worktreeDisplay: "",
      messages: [],
    });
    assert.equal(segments[0]!.source, "system");
  });
});
