import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatChatMessageForCliPreview } from "../../src/domain/chat/content/message-body-text.js";
import {
  buildUserVfsTurnView,
  matchUserVfsTurnAt,
  parseAllUserVfsActionsFromText,
  USER_VFS_TURN_ACK_TEXT,
} from "../../src/domain/chat/logic/user-vfs-turn-view.js";
import { wrapUserVfsActionsForStorage } from "../../src/domain/chat/logic/user-vfs-turn-constants.js";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";

function msg(
  id: string,
  seq: number,
  role: ChatMessage["role"],
  blocks: ChatMessage["content"]["blocks"],
  raw?: Record<string, unknown>,
): ChatMessage {
  return {
    id,
    sessionId: "s1",
    seq,
    role,
    content: { blocks },
    provider: null,
    raw: raw ?? null,
    createdAtMs: seq,
    hidden: false,
  };
}

describe("parseAllUserVfsActionsFromText", () => {
  it("解析 burst 合并的多条 action", () => {
    const actions = parseAllUserVfsActionsFromText(
      '<user-vfs-action kind="delete" path="/a.md" />\n' +
        '<user-vfs-action kind="save" path="/b.md" method="edit" hunks="1">' +
        '<edit-hunk index="1"><old>x</old><new>y</new></edit-hunk></user-vfs-action>',
    );
    assert.equal(actions.length, 2);
    assert.equal(actions[0]?.kind, "delete");
    assert.equal(actions[1]?.method, "edit");
    assert.equal(actions[1]?.hunks.length, 1);
  });
});

describe("matchUserVfsTurnAt", () => {
  it("UA 两段可匹配（LLM 路径）", () => {
    const actionXml = '<user-vfs-action kind="delete" path="/a.md" />';
    const messages: ChatMessage[] = [
      msg("u1", 1, "user", [{ type: "text", text: wrapUserVfsActionsForStorage(actionXml) }], {
        metadata: { kind: "user_vfs_action", source: "user", synthetic: true },
      }),
      msg("a1", 2, "assistant", [{ type: "text", text: USER_VFS_TURN_ACK_TEXT }], {
        metadata: { kind: "user_vfs_ack", synthetic: true },
      }),
    ];
    const turn = matchUserVfsTurnAt(messages, 0);
    assert.ok(turn != null);
    const view = buildUserVfsTurnView(turn);
    assert.equal(view.id, "u1");
    assert.equal(view.bridgeText, USER_VFS_TURN_ACK_TEXT);
  });

  it("hidden UA 对：At 返回 null", () => {
    const actionXml = '<user-vfs-action kind="delete" path="/a.md" />';
    const hiddenMessages: ChatMessage[] = [
      msg(
        "u1",
        1,
        "user",
        [{ type: "text", text: wrapUserVfsActionsForStorage(actionXml) }],
        { metadata: { kind: "user_vfs_action", source: "user", synthetic: true } },
      ),
      msg(
        "a1",
        2,
        "assistant",
        [{ type: "text", text: USER_VFS_TURN_ACK_TEXT }],
        { metadata: { kind: "user_vfs_ack", synthetic: true } },
      ),
    ];
    hiddenMessages[0] = { ...hiddenMessages[0]!, hidden: true };
    hiddenMessages[1] = { ...hiddenMessages[1]!, hidden: true };

    assert.equal(matchUserVfsTurnAt(hiddenMessages, 0), null);
  });

  it("仅 ack hidden 时 At 返回 null", () => {
    const actionXml = '<user-vfs-action kind="delete" path="/a.md" />';
    const messages: ChatMessage[] = [
      msg(
        "u1",
        1,
        "user",
        [{ type: "text", text: wrapUserVfsActionsForStorage(actionXml) }],
        { metadata: { kind: "user_vfs_action", source: "user", synthetic: true } },
      ),
      msg(
        "a1",
        2,
        "assistant",
        [{ type: "text", text: USER_VFS_TURN_ACK_TEXT }],
        { metadata: { kind: "user_vfs_ack", synthetic: true } },
      ),
    ];
    messages[1] = { ...messages[1]!, hidden: true };
    assert.equal(matchUserVfsTurnAt(messages, 0), null);
  });

  it("旧 U-A-U-A 四段不匹配", () => {
    const messages: ChatMessage[] = [
      msg("u1", 1, "user", [{ type: "text", text: "<user-vfs-action kind=\"delete\" path=\"/a.md\" />" }], {
        metadata: { kind: "user_vfs_action", source: "user", synthetic: true },
      }),
      msg("a1", 2, "assistant", [
        { type: "tool_use", id: "tu1", name: "fs", input: { command: "…" } },
      ], { metadata: { synthetic: true, actor: "user", toolInputCompressed: true } }),
      msg("u2", 3, "user", [
        { type: "tool_result", toolUseId: "tu1", content: "ok", ok: true },
      ], { metadata: { source: "user", synthetic: true } }),
      msg("a2", 4, "assistant", [{ type: "text", text: "【done】" }], {
        metadata: { kind: "tool_turn_bridge", synthetic: true },
      }),
    ];
    assert.equal(matchUserVfsTurnAt(messages, 0), null);
  });
});

describe("formatChatMessageForCliPreview", () => {
  it("同一消息多条 tool_result 合并为一个 tool 段", () => {
    const segments = formatChatMessageForCliPreview(
      msg("u2", 3, "user", [
        { type: "tool_result", toolUseId: "tu1", content: "ok", ok: true },
        { type: "tool_result", toolUseId: "tu2", content: "ok", ok: true },
      ]),
    );
    assert.equal(segments.filter((s) => s.role === "tool").length, 1);
    assert.equal(segments[0]?.body, "ok\n\nok");
  });

  it("assistant 的 tool_use 与正文拆成独立段", () => {
    const segments = formatChatMessageForCliPreview(
      msg("a1", 20, "assistant", [
        { type: "text", text: "已完成删除。" },
        {
          type: "tool_use",
          id: "call_1",
          name: "fs",
          input: { command: "ls /" },
        },
      ]),
    );
    assert.equal(segments.length, 2);
    assert.equal(segments[0]?.role, "assistant");
    assert.equal(segments[0]?.body, "已完成删除。");
    assert.equal(segments[1]?.role, "tool_call");
    assert.match(segments[1]?.body ?? "", /\[tool_use name=fs/);
  });

  it("剥离 text 块中泄漏的闭合思考标签", () => {
    const closeTag = "</" + "redacted_thinking" + ">";
    const segments = formatChatMessageForCliPreview(
      msg("a2", 21, "assistant", [
        { type: "text", text: `回复正文${closeTag}` },
      ]),
    );
    assert.equal(segments[0]?.body, "回复正文");
  });
});
