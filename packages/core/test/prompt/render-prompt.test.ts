import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPromptLlmInput,
  buildPromptPreviewSegments,
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
      filetreeDisplay: "TREE",
      messages,
      now: fixedNow,
    });
    assert.equal(input.system, "ctx");
    assert.equal(input.messages.length, 1);
    assert.equal(input.messages[0]!.content.blocks[0]!.type, "text");
  });

  it("expands {{.filetree}} in system blocks", () => {
    const blocks: PromptBlock[] = [
      {
        name: "tree",
        type: "text",
        role: "system",
        content: "Files:\n{{ .filetree }}",
      },
    ];
    const input = buildPromptLlmInput(blocks, {
      worktreeDisplay: "",
      filetreeDisplay: "/\n└── README.md",
      messages: [],
      now: fixedNow,
    });
    assert.equal(input.system, "Files:\n/\n└── README.md");
  });
});

describe("buildPromptPreviewSegments", () => {
  it("segments join to the same text as formatPromptLlmInputForCli", () => {
    const blocks: PromptBlock[] = [
      { name: "s", type: "text", role: "system", content: "ctx" },
      { name: "c", type: "chat" },
      { name: "u", type: "text", role: "user", content: "ask" },
    ];
    const messages = [message("user", "{{literal}}", 1)];
    const ctx = { worktreeDisplay: "WT", filetreeDisplay: "TREE", messages, now: fixedNow };
    const input = buildPromptLlmInput(blocks, ctx);
    const segments = buildPromptPreviewSegments(blocks, input, ctx);
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
    assert.equal(joined, formatPromptLlmInputForCli(blocks, input, ctx));
    assert.equal(segments.length, 3);
    assert.equal(segments[0]!.id, "text-s");
    assert.equal(segments[1]!.id, "chat-m1-0");
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
    const ctx = { worktreeDisplay: "WT", filetreeDisplay: "TREE", messages, now: fixedNow };
    const input = buildPromptLlmInput(blocks, ctx);
    const out = formatPromptLlmInputForCli(blocks, input, ctx);
    assert.equal(out, "system: ctx\nuser: {{literal}}\nuser: ask");
  });

  it("joins two text blocks with single newline", () => {
    const blocks: PromptBlock[] = [
      { name: "a", type: "text", role: "system", content: "one" },
      { name: "b", type: "text", role: "user", content: "two" },
    ];
    const ctx = { worktreeDisplay: "", filetreeDisplay: "", messages: [], now: fixedNow };
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
    const ctx = { worktreeDisplay: "", filetreeDisplay: "", messages: [], now: fixedNow };
    const input = buildPromptLlmInput(blocks, ctx);
    const out = formatPromptLlmInputForCli(blocks, input, ctx);
    assert.equal(out, "system: line1\nline2");
  });

  it("renders tool_use input and tool role results in chat preview", () => {
    const blocks: PromptBlock[] = [{ name: "c", type: "chat" }];
    const messages: ChatMessage[] = [
      message("user", "write a file", 1),
      {
        id: "m2",
        sessionId: "s1",
        seq: 2,
        role: "assistant",
        content: {
          blocks: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "vfs.write",
              input: { path: "/love_message.txt", content: "hi" },
            },
          ],
        },
        provider: null,
        raw: null,
        createdAtMs: 2,
        hidden: false,
      },
      {
        id: "m3",
        sessionId: "s1",
        seq: 3,
        role: "user",
        content: {
          blocks: [
            {
              type: "tool_result",
              toolUseId: "tool-1",
              content: '{\n  "version": 1\n}',
            },
          ],
        },
        provider: null,
        raw: null,
        createdAtMs: 3,
        hidden: false,
      },
    ];
    const ctx = { worktreeDisplay: "", filetreeDisplay: "", messages, now: fixedNow };
    const input = buildPromptLlmInput(blocks, ctx);
    const out = formatPromptLlmInputForCli(blocks, input, ctx);
    assert.match(out, /assistant: \[tool_use name=vfs\.write id=tool-1\]/);
    assert.match(out, /"path": "\/love_message\.txt"/);
    assert.match(out, /tool: ok/);
    assert.ok(!out.includes("user: [tool_result"));
  });
});
