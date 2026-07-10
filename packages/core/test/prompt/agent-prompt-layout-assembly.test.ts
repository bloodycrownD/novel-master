import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { textBlocks, type ChatMessage } from "@novel-master/core/chat";

import { buildPromptLlmInputFromLayout, formatPromptLlmInputForCliFromLayout, messageBodyText, type AgentPromptLayout } from "@novel-master/core/prompt";

import type { WorktreeService } from "@novel-master/core/worktree";

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

function mockWorktree(fileTree: string): WorktreeService {
  return {
    renderFileTree: async () => fileTree,
  } as unknown as WorktreeService;
}

describe("buildPromptLlmInputFromLayout assembly order", () => {
  const layout: AgentPromptLayout = {
    system: "sys",
    persistEnabled: true,
    dynamicEnabled: true,
    persist: [
      { name: "persona", type: "text", role: "user", content: "人设" },
      { name: "tail", type: "text", role: "assistant", content: "ok" },
      { name: "canon", type: "worktree" },
    ],
    dynamic: [
      {
        name: "state",
        type: "text",
        role: "user",
        content: "树: {{$filetree}}",
        lifecycle: "once",
      },
    ],
  };

  it("顺序：system 字段 + worktree 对 + persist 文本 + chat + dynamic", async () => {
    const worktree = mockWorktree("/\n└── readme.md 全部加载");
    const input = await buildPromptLlmInputFromLayout(
      layout,
      {
        worktreeDisplay: "WT-BODY",
        messages: [message("user", "hi", 1)],
        now: fixedNow,
        worktree,
      },
      { agentStepIndex: 0 },
    );
    assert.equal(input.system, "sys");
    assert.equal(input.messages.length, 6);
    assert.equal(input.messages[0]!.id, "prompt:worktree:canon");
    assert.equal(input.messages[1]!.id, "prompt:worktree:canon:done");
    assert.equal(input.messages[2]!.id, "prompt:persona");
    assert.equal(input.messages[3]!.id, "prompt:tail");
    assert.equal(input.messages[4]!.id, "m1");
    assert.equal(input.messages[5]!.id, "prompt:state");
  });

  it("dynamic lifecycle once 在 step≥1 跳过", async () => {
    const input = await buildPromptLlmInputFromLayout(
      layout,
      { worktreeDisplay: "WT", messages: [], worktree: mockWorktree("/") },
      { agentStepIndex: 1 },
    );
    assert.equal(input.messages.length, 4);
    assert.equal(input.messages[0]!.id, "prompt:worktree:canon");
    assert.equal(input.messages[1]!.id, "prompt:worktree:canon:done");
    assert.equal(input.messages[2]!.id, "prompt:persona");
    assert.equal(input.messages[3]!.id, "prompt:tail");
  });

  it("$filetree 走 WorktreeService.renderFileTree，不调用 vfs.list", async () => {
    const renderFileTree = mock.fn(async () => "/\n└── x.md 全部加载");
    const worktree = { renderFileTree } as unknown as WorktreeService;
    const list = mock.fn(async () => []);
    const vfs = { list } as unknown as import("@novel-master/core/vfs").VfsService;
    const input = await buildPromptLlmInputFromLayout(
      {
        dynamicEnabled: true,
        persist: [],
        dynamic: [
          { name: "d", type: "text", role: "user", content: "{{$filetree}}" },
        ],
      },
      { worktreeDisplay: "", messages: [], worktree, vfs },
    );
    assert.equal(renderFileTree.mock.callCount(), 1);
    assert.equal(list.mock.callCount(), 0);
    assert.match(messageBodyText(input.messages[0]!), /x\.md 全部加载/);
  });
});

describe("formatPromptLlmInputForCliFromLayout", () => {
  it("system 段在首行", async () => {
    const out = await formatPromptLlmInputForCliFromLayout(
      { system: "ctx", persist: [], dynamic: [] },
      { worktreeDisplay: "", messages: [] },
    );
    assert.equal(out, "system: ctx");
  });
});
