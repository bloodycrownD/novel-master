import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessageDto } from "@shared/ipc-types";
import {
  USER_VFS_TURN_ACK_TEXT,
  wrapUserVfsActionsForStorage,
} from "@novel-master/core/chat";
import {
  buildChatListItems,
  isTurnToolExecuting,
  vfsToolFilePath,
} from "@/features/chat/message-blocks";

function assistantWithTool(id: string, seq: number): ChatMessageDto {
  return {
    id,
    sessionId: "s1",
    seq,
    role: "assistant",
    hidden: false,
    createdAtMs: seq,
    bodyText: "",
    contentBlocks: [
      { type: "tool_use", id: "tu1", name: "read", input: { path: "/a.md" } },
    ],
  };
}

test("T13: 工具卡执行中仅绑 agentRunning（agentActive），与 uiRunning 分离", () => {
  const assistant = assistantWithTool("a1", 1);
  assert.equal(isTurnToolExecuting(assistant, [assistant], true), true);
  assert.equal(isTurnToolExecuting(assistant, [assistant], false), false);
});

test("T-ARP-U1：tu1 success + tu2 unpaired + runUiStopped → tu1 success、tu2 error", () => {
  const assistant: ChatMessageDto = {
    id: "a1",
    sessionId: "s1",
    seq: 1,
    role: "assistant",
    hidden: false,
    createdAtMs: 1,
    bodyText: "",
    contentBlocks: [
      { type: "tool_use", id: "tu1", name: "read", input: { path: "/a.md" } },
      { type: "tool_use", id: "tu2", name: "list", input: {} },
    ],
  };
  const userResult: ChatMessageDto = {
    id: "u1",
    sessionId: "s1",
    seq: 2,
    role: "user",
    hidden: false,
    createdAtMs: 2,
    bodyText: "",
    contentBlocks: [
      { type: "tool_result", toolUseId: "tu1", content: "ok", ok: true },
    ],
  };
  const items = buildChatListItems([assistant, userResult], {
    agentRunning: true,
    runUiStopped: true,
  });
  assert.equal(items.length, 1);
  if (items[0]?.kind === "message") {
    assert.equal(items[0].tools.length, 2);
    const byId = new Map(items[0].tools.map((tool) => [tool.toolUseId, tool]));
    assert.equal(byId.get("tu1")?.status, "success");
    assert.equal(byId.get("tu2")?.status, "error");
  }
});

test("T-ARP-U2：无 result 且 agent 未跑时工具卡标失败", () => {
  const assistant = assistantWithTool("a1", 1);
  const items = buildChatListItems([assistant], { agentRunning: false });
  assert.equal(items.length, 1);
  if (items[0]?.kind === "message") {
    assert.equal(items[0].tools.length, 1);
    assert.equal(items[0].tools[0]?.status, "error");
  }
});

test("T-ARP-U2：runUiStopped 时 unpaired 工具标失败（即使 agentRunning）", () => {
  const assistant = assistantWithTool("a1", 1);
  const items = buildChatListItems([assistant], {
    agentRunning: true,
    runUiStopped: true,
  });
  if (items[0]?.kind === "message") {
    assert.equal(items[0].tools[0]?.status, "error");
  }
});

test("agentRunning 时当前未完成回合工具卡为 pending", () => {
  const assistant = assistantWithTool("a1", 1);
  const items = buildChatListItems([assistant], { agentRunning: true });
  if (items[0]?.kind === "message") {
    assert.equal(items[0].tools[0]?.status, "pending");
  }
});

test("vfsToolFilePath：read/write/edit 与 vfs.* 前缀返回绝对路径", () => {
  assert.equal(
    vfsToolFilePath({
      toolUseId: "t1",
      name: "read",
      input: { path: "/notes/ch1.md" },
      status: "success",
    }),
    "/notes/ch1.md",
  );
  assert.equal(
    vfsToolFilePath({
      toolUseId: "t2",
      name: "write",
      input: { path: "/drafts/a.md" },
      status: "success",
    }),
    "/drafts/a.md",
  );
  assert.equal(
    vfsToolFilePath({
      toolUseId: "t3",
      name: "edit",
      input: { path: "/续写/a.md" },
      status: "success",
    }),
    "/续写/a.md",
  );
  assert.equal(
    vfsToolFilePath({
      toolUseId: "t4",
      name: "vfs.read",
      input: { path: "/x.md" },
      status: "success",
    }),
    "/x.md",
  );
  assert.equal(
    vfsToolFilePath({
      toolUseId: "t4b",
      name: "vfs.write",
      input: { path: "/y.md" },
      status: "success",
    }),
    "/y.md",
  );
});

test("vfsToolFilePath：delete 与非文件工具返回 undefined", () => {
  assert.equal(
    vfsToolFilePath({
      toolUseId: "t5",
      name: "delete",
      input: { path: "/gone.md" },
      status: "success",
    }),
    undefined,
  );
  assert.equal(
    vfsToolFilePath({
      toolUseId: "t6",
      name: "fs",
      input: { command: "ls /" },
      status: "success",
    }),
    undefined,
  );
});

test("vfsToolFilePath：相对 path 规范化为绝对逻辑路径", () => {
  assert.equal(
    vfsToolFilePath({
      toolUseId: "t7",
      name: "read",
      input: { path: "relative.md" },
      status: "success",
    }),
    "/relative.md",
  );
});

test("T-SR3：空正文 + 仅 user_ops attachments 仍进列表", () => {
  const opsOnly: ChatMessageDto = {
    id: "u-ops",
    sessionId: "s1",
    seq: 1,
    role: "user",
    hidden: false,
    createdAtMs: 1,
    bodyText: "",
    contentBlocks: [{ type: "text", text: "" }],
    attachments: [
      {
        name: "mkdir:/notes",
        source: "user_ops",
        type: "text",
        content: '<action name="mkdir">\n{"path":"/notes"}\n</action>',
        path: "/notes",
      },
    ],
  };
  const items = buildChatListItems([opsOnly]);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.kind, "message");
  if (items[0]?.kind === "message") {
    assert.equal(items[0].textParts.length, 0);
    assert.equal(items[0].message.attachments?.length, 1);
    assert.equal(items[0].message.attachments?.[0]?.source, "user_ops");
  }
});

test("T-SR3：空正文 + workplace attachments 仍进列表", () => {
  const workplaceOnly: ChatMessageDto = {
    id: "u-wp",
    sessionId: "s1",
    seq: 1,
    role: "user",
    hidden: false,
    createdAtMs: 1,
    bodyText: "",
    contentBlocks: [],
    attachments: [
      {
        name: "w.md",
        source: "workplace",
        type: "text",
        content: null,
        path: "/w.md",
      },
    ],
  };
  const items = buildChatListItems([workplaceOnly]);
  assert.equal(items.length, 1);
  if (items[0]?.kind === "message") {
    assert.equal(items[0].message.attachments?.[0]?.source, "workplace");
  }
});

test("T-SR3：空正文且无 attachments 不进列表", () => {
  const empty: ChatMessageDto = {
    id: "u-empty",
    sessionId: "s1",
    seq: 1,
    role: "user",
    hidden: false,
    createdAtMs: 1,
    bodyText: "",
    contentBlocks: [{ type: "text", text: "   " }],
  };
  assert.equal(buildChatListItems([empty]).length, 0);
});

test("T-UO2x：历史 UA 两段按普通 message，无 user_vfs_turn", () => {
  const actionXml = '<action name="delete">\n{"path":"/a.md"}\n</action>';
  const messages: ChatMessageDto[] = [
    {
      id: "u1",
      sessionId: "s1",
      seq: 1,
      role: "user",
      hidden: false,
      createdAtMs: 1,
      bodyText: wrapUserVfsActionsForStorage(actionXml),
      contentBlocks: [
        { type: "text", text: wrapUserVfsActionsForStorage(actionXml) },
      ],
      metadata: {
        kind: "user_vfs_action",
        source: "user",
        synthetic: true,
      },
    },
    {
      id: "a1",
      sessionId: "s1",
      seq: 2,
      role: "assistant",
      hidden: false,
      createdAtMs: 2,
      bodyText: USER_VFS_TURN_ACK_TEXT,
      contentBlocks: [{ type: "text", text: USER_VFS_TURN_ACK_TEXT }],
      metadata: { kind: "user_vfs_ack", synthetic: true },
    },
  ];
  const items = buildChatListItems(messages);
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.kind === "message"));
  assert.equal(items[0]?.kind === "message" && items[0].message.id, "u1");
  assert.equal(items[1]?.kind === "message" && items[1].message.id, "a1");
});
