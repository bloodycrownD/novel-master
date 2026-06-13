import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  buildPromptLlmInputFromLayout,
  formatPromptLlmInputForCliFromLayout,
  messageBodyText,
  textBlocks,
  type AgentPromptLayout,
  type ChatMessage,
  type VfsListEntry,
  type VfsService,
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

function mockVfs(entries: readonly VfsListEntry[]): VfsService {
  return {
    async list() {
      return [...entries];
    },
  } as unknown as VfsService;
}

describe("buildPromptLlmInputFromLayout assembly order", () => {
  const layout: AgentPromptLayout = {
    system: "sys",
    persist: [
      { name: "persona", type: "text", role: "user", content: "人设" },
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

  it("顺序：system 字段 + persist + chat + dynamic", async () => {
    const vfs = mockVfs([{ path: "/readme.md", kind: "file" }]);
    const input = await buildPromptLlmInputFromLayout(
      layout,
      {
        worktreeDisplay: "WT-BODY",
        messages: [message("user", "hi", 1)],
        now: fixedNow,
        vfs,
      },
      { agentStepIndex: 0 },
    );
    assert.equal(input.system, "sys");
    assert.equal(input.messages.length, 4);
    assert.equal(input.messages[0]!.id, "prompt:persona");
    assert.equal(input.messages[1]!.id, "prompt:worktree:canon");
    assert.equal(input.messages[2]!.id, "m1");
    assert.equal(input.messages[3]!.id, "prompt:state");
  });

  it("dynamic lifecycle once 在 step≥1 跳过", async () => {
    const input = await buildPromptLlmInputFromLayout(
      layout,
      { worktreeDisplay: "WT", messages: [], vfs: mockVfs([]) },
      { agentStepIndex: 1 },
    );
    assert.equal(input.messages.length, 2);
    assert.equal(input.messages[0]!.id, "prompt:persona");
    assert.equal(input.messages[1]!.id, "prompt:worktree:canon");
  });

  it("$filetree 走 VFS list，不调用 WorktreeService", async () => {
    const list = mock.fn(async () => [{ path: "/x.md", kind: "file" as const }]);
    const vfs = { list } as unknown as VfsService;
    const input = await buildPromptLlmInputFromLayout(
      {
        persist: [],
        dynamic: [
          { name: "d", type: "text", role: "user", content: "{{$filetree}}" },
        ],
      },
      { worktreeDisplay: "", messages: [], vfs },
    );
    assert.equal(list.mock.callCount(), 1);
    assert.match(messageBodyText(input.messages[0]!), /x\.md/);
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
