import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { registerBuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import { createChatGrepTool } from "../../src/domain/tool/builtin/chat-grep-tool.js";
import { textBlocks } from "../../src/domain/chat/content/text-blocks.js";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import { TOOL_OUTPUT_MAX_MATCHES } from "../../src/domain/tool/logic/tool-output-limits.js";

function mockMessages(messages: ChatMessage[]): () => Promise<readonly ChatMessage[]> {
  return async () => messages;
}

describe("chat_grep tool", () => {
  it("T7: finds matches with seq/role/line including hidden", async () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        sessionId: "s1",
        seq: 1,
        role: "user",
        content: textBlocks("hello world"),
        provider: null,
        raw: null,
        createdAtMs: 1,
        hidden: false,
      },
      {
        id: "m2",
        sessionId: "s1",
        seq: 2,
        role: "assistant",
        content: textBlocks("no match here"),
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
        content: textBlocks("hello again\nsecond line hello"),
        provider: null,
        raw: null,
        createdAtMs: 3,
        hidden: true,
      },
    ];

    const registry = new ToolRegistry<BuiltinToolContext>();
    registry.register(createChatGrepTool());
    const runner = new ToolRunner(registry);
    const ctx: BuiltinToolContext = {
      vfs: {} as BuiltinToolContext["vfs"],
      projectId: "p1",
      sessionId: "s1",
      listSessionMessages: mockMessages(messages),
    };

    const result = await runner.call<{
      matches: Array<{ seq: number; role: string; line: number; hidden: boolean }>;
      total: number;
      truncated: boolean;
    }>("chat_grep", { pattern: "hello" }, ctx);

    assert.equal(result.total, 3);
    assert.equal(result.matches.length, 3);
    assert.ok(result.matches.some((m) => m.hidden === true && m.seq === 3));
    assert.ok(result.matches.some((m) => m.role === "user" && m.line === 1));
  });

  it("T7: truncates when matches exceed cap", async () => {
    const messages: ChatMessage[] = Array.from(
      { length: TOOL_OUTPUT_MAX_MATCHES + 10 },
      (_, i) => ({
        id: `m-${i}`,
        sessionId: "s1",
        seq: i + 1,
        role: "user",
        content: textBlocks(`needle line ${i}`),
        provider: null,
        raw: null,
        createdAtMs: i,
        hidden: false,
      }),
    );

    const registry = new ToolRegistry<BuiltinToolContext>();
    registry.register(createChatGrepTool());
    const runner = new ToolRunner(registry);
    const ctx: BuiltinToolContext = {
      vfs: {} as BuiltinToolContext["vfs"],
      projectId: "p1",
      sessionId: "s1",
      listSessionMessages: mockMessages(messages),
    };

    const result = await runner.call<{ total: number; truncated: boolean; matches: unknown[] }>(
      "chat_grep",
      { pattern: "needle" },
      ctx,
    );
    assert.equal(result.total, TOOL_OUTPUT_MAX_MATCHES + 10);
    assert.equal(result.truncated, true);
    assert.equal(result.matches.length, TOOL_OUTPUT_MAX_MATCHES);
  });
});

describe("registerBuiltinTools", () => {
  it("registers 7 V2 tools", () => {
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    assert.equal(registry.list().length, 7);
    assert.deepEqual(registry.list().sort(), [
      "chat_grep",
      "edit",
      "fs",
      "glob",
      "grep",
      "read",
      "write",
    ]);
  });
});
