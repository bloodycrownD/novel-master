import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatChatMessageForCliPreview } from "../../src/domain/chat/content/message-body-text.js";
import {
  buildUserVfsTurnView,
  deriveToolUsesFromVfsActions,
  formatUserVfsTurnPreviewBody,
  matchUserVfsTurnAt,
  parseAllUserVfsActionsFromText,
} from "../../src/domain/chat/logic/user-vfs-turn-view.js";
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

describe("deriveToolUsesFromVfsActions", () => {
  it("从 action XML 还原完整 tool input（非压缩 …）", () => {
    const actions = parseAllUserVfsActionsFromText(
      '<user-vfs-action kind="delete" path="/test.md" />\n' +
        '<user-vfs-action kind="save" path="/b.md" method="edit">' +
        '<edit-hunk index="1"><old>x</old><new>y</new></edit-hunk></user-vfs-action>',
    );
    const derived = deriveToolUsesFromVfsActions(actions);
    assert.equal(derived.length, 2);
    assert.equal(derived[0]?.name, "fs");
    assert.match(String(derived[0]?.input.command), /rm.*\/test\.md/);
    assert.equal(derived[1]?.name, "edit");
    assert.equal(derived[1]?.input.path, "/b.md");
    assert.equal(derived[1]?.input.oldString, "x");
    assert.equal(derived[1]?.input.newString, "y");
  });
});

describe("matchUserVfsTurnAt", () => {
  it("识别完整 U-A-U-A 四段", () => {
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
    const turn = matchUserVfsTurnAt(messages, 0);
    assert.ok(turn != null);
    const view = buildUserVfsTurnView(turn);
    assert.equal(view.actions.length, 1);
    assert.equal(view.toolUses.length, 1);
    assert.match(formatUserVfsTurnPreviewBody(view), /用户 VFS 操作/);
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
});
