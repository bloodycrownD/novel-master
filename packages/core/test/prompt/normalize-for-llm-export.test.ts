/**
 * normalize-for-llm-export 单测（spec §测试策略表）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import { normalizeForLlmExport } from "../../src/domain/prompt/logic/normalize-for-llm-export.js";
import { messageBodyText } from "../../src/domain/prompt/logic/message-body.js";

function msg(
  role: string,
  text: string,
  options?: {
    readonly id?: string;
    readonly raw?: Record<string, unknown> | null;
    readonly blocks?: ChatMessage["content"]["blocks"];
  },
): ChatMessage {
  const blocks =
    options?.blocks ??
    (text === "" ? [] : [{ type: "text" as const, text }]);
  return {
    id: options?.id ?? `m-${role}`,
    sessionId: "s1",
    seq: 1,
    role,
    content: { blocks },
    provider: null,
    raw: options?.raw ?? null,
    createdAtMs: 0,
    hidden: false,
  };
}

describe("normalizeForLlmExport", () => {
  it("persist 区内连续 user 纯文本 merge", () => {
    const messages = [
      msg("user", "a", { id: "p1" }),
      msg("user", "b", { id: "p2" }),
    ];
    const out = normalizeForLlmExport(messages, "anthropic", {
      persistCount: 2,
      dynamicCount: 0,
    });
    assert.equal(out.length, 1);
    assert.equal(messageBodyText(out[0]!), "a\n\nb");
    assert.equal(out[0]!.id, "p1");
  });

  it("persist 与 chat 跨区不 merge", () => {
    const messages = [
      msg("user", "persist", { id: "p1" }),
      msg("user", "chat", { id: "c1" }),
    ];
    const out = normalizeForLlmExport(messages, "anthropic", {
      persistCount: 1,
      dynamicCount: 0,
    });
    assert.equal(out.length, 2);
    assert.equal(messageBodyText(out[0]!), "persist");
    assert.equal(messageBodyText(out[1]!), "chat");
  });

  it("vfs 段（metadata.kind）不与 plain chat merge", () => {
    const vfsAction = msg("user", "<user-vfs-action/>", {
      id: "vfs1",
      raw: { metadata: { kind: "user_vfs_action", source: "user" } },
    });
    const plain = msg("user", "hello", { id: "c1" });
    const out = normalizeForLlmExport([vfsAction, plain], "anthropic", {
      persistCount: 0,
      dynamicCount: 0,
    });
    assert.equal(out.length, 2);
  });

  it("含 tool 块不 merge", () => {
    const text = msg("user", "a", { id: "u1" });
    const tool = msg("user", "", {
      id: "u2",
      blocks: [
        { type: "tool_result", toolUseId: "tu_1", content: "ok" },
      ],
    });
    const out = normalizeForLlmExport([text, tool], "anthropic", {
      persistCount: 0,
      dynamicCount: 0,
    });
    assert.equal(out.length, 2);
  });

  it("U-A-U-A 四条不拆分（条数保持）", () => {
    const uaUa = [
      msg("user", "<user-vfs-action/>", {
        id: "u1",
        raw: { metadata: { kind: "user_vfs_action", source: "user" } },
      }),
      msg("assistant", "", {
        id: "a1",
        blocks: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "write",
            input: { path: "/a.md", content: "x" },
          },
        ],
        raw: { metadata: { synthetic: true, actor: "user" } },
      }),
      msg("user", "", {
        id: "u2",
        blocks: [
          { type: "tool_result", toolUseId: "tu_1", content: "ok" },
        ],
        raw: { metadata: { source: "user" } },
      }),
      msg("assistant", "【done】", {
        id: "a2",
        raw: { metadata: { kind: "tool_turn_bridge", synthetic: true } },
      }),
    ];
    const out = normalizeForLlmExport(uaUa, "anthropic", {
      persistCount: 0,
      dynamicCount: 0,
    });
    assert.equal(out.length, 4);
  });

  it("OpenAI 剔除空 tool_turn_bridge", () => {
    const bridge = msg("assistant", "", {
      id: "bridge",
      raw: { metadata: { kind: "tool_turn_bridge", synthetic: true } },
    });
    const chat = msg("user", "hi", { id: "c1" });
    const out = normalizeForLlmExport([chat, bridge], "openai", {
      persistCount: 0,
      dynamicCount: 0,
    });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.id, "c1");
  });
});
