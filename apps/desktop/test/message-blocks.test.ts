import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessageDto } from "@shared/ipc-types";
import {
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
