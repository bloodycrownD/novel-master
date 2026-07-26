/**
 * T-UOL7：Desktop main handleMessagesRollback — undo_send / rewind 均 clearUserOpsLog 推空。
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  appendUserOpsLog,
  listUserOpsLog,
  resetUserOpsLogStoreForTests,
  textBlocks,
} from "@novel-master/core/chat";
import { IPC_CHANNELS } from "../shared/ipc-types.js";
import { setComposerAttachmentsSuggestForwardTarget } from "../src/main/ipc/forward-composer-attachments-suggest.js";
import {
  handleMessagesRollback,
} from "../src/main/ipc/handlers/messages.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("handleMessagesRollback (T-UOL7 / D8)", () => {
  let tempDir: string;
  let projectId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-rollback-uol-"));
    const project = await handleProjectsCreate({ name: "rollback-uol" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  beforeEach(() => {
    resetUserOpsLogStoreForTests();
  });

  async function createSession(title: string): Promise<string> {
    const session = await handleSessionsCreate({ projectId, title });
    assert.equal(session.ok, true);
    if (!session.ok) {
      throw new Error("failed to create session");
    }
    return session.data.id;
  }

  it("T-UOL7 undo_send: truncate 后 clearUserOpsLog 并 COMPOSER_ATTACHMENTS_SUGGEST 推空", async () => {
    const sessionId = await createSession("undo-send");
    const rt = await getDesktopRuntime();
    const actionXml =
      '<action name="write">\n{"path":"/hand.md","content":"hi"}\n</action>';
    const msg = await rt.messages.append(
      sessionId,
      "user",
      textBlocks("请看看"),
      {
        attachments: [
          {
            name: "/hand.md",
            source: "user_ops",
            type: "text",
            content: actionXml,
            path: "/hand.md",
            action: "write",
          },
        ],
      },
    );

    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    const result = await handleMessagesRollback({
      projectId,
      sessionId,
      messageId: msg.id,
      skipVfsReconcile: true,
    });
    assert.equal(result.ok, true);

    assert.equal(listUserOpsLog(sessionId).length, 0);

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.channel, IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST);
    assert.deepEqual(sent[0]?.payload, {
      sessionId,
      attachments: [],
    });

    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });

  it("T-UOL7 undo_send: 清空 store（含既有未发送 ops，不映回消息手改）", async () => {
    const sessionId = await createSession("undo-send-coexist");
    const rt = await getDesktopRuntime();

    appendUserOpsLog(sessionId, {
      id: "uol-unsent",
      createdAtMs: 1,
      actionXml:
        '<action name="write">\n{"path":"/keep.md","content":"k"}\n</action>',
      action: "write",
      path: "/keep.md",
      content: "k",
    });

    const actionXml =
      '<action name="edit">\n{"path":"/hand.md","oldString":"a","newString":"b"}\n</action>';
    const msg = await rt.messages.append(
      sessionId,
      "user",
      textBlocks("请看手改"),
      {
        attachments: [
          {
            name: "/hand.md",
            source: "user_ops",
            type: "text",
            content: actionXml,
            path: "/hand.md",
            action: "edit",
          },
        ],
      },
    );

    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    const result = await handleMessagesRollback({
      projectId,
      sessionId,
      messageId: msg.id,
      skipVfsReconcile: true,
    });
    assert.equal(result.ok, true);

    assert.equal(listUserOpsLog(sessionId).length, 0);

    assert.deepEqual(sent[0]?.payload, {
      sessionId,
      attachments: [],
    });

    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });

  it("T-UOL7 rewind: 不 parse 手改；推空；store 空", async () => {
    const sessionId = await createSession("rewind");
    const rt = await getDesktopRuntime();
    const userMsg = await rt.messages.append(
      sessionId,
      "user",
      textBlocks("问一下"),
    );
    const assistant = await rt.messages.append(
      sessionId,
      "assistant",
      textBlocks("答一下"),
      {
        attachments: [
          {
            name: "/should-not-restore.md",
            source: "user_ops",
            type: "text",
            content:
              '<action name="write">\n{"path":"/should-not-restore.md","content":"x"}\n</action>',
            path: "/should-not-restore.md",
            action: "write",
          },
        ],
      },
    );
    void userMsg;

    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    const result = await handleMessagesRollback({
      projectId,
      sessionId,
      messageId: assistant.id,
      skipVfsReconcile: true,
    });
    assert.equal(result.ok, true);
    assert.equal(listUserOpsLog(sessionId).length, 0);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]?.payload, {
      sessionId,
      attachments: [],
    });

    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });

  it("T-UOL7 rewind: 回滚前预置未发送 ops → store 空、推空", async () => {
    const sessionId = await createSession("rewind-unsent");
    const rt = await getDesktopRuntime();

    appendUserOpsLog(sessionId, {
      id: "uol-unsent",
      createdAtMs: 1,
      actionXml:
        '<action name="write">\n{"path":"/keep.md","content":"k"}\n</action>',
      action: "write",
      path: "/keep.md",
      content: "k",
    });

    const userMsg = await rt.messages.append(
      sessionId,
      "user",
      textBlocks("问一下"),
    );
    const assistant = await rt.messages.append(
      sessionId,
      "assistant",
      textBlocks("答一下"),
    );
    void userMsg;

    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    const result = await handleMessagesRollback({
      projectId,
      sessionId,
      messageId: assistant.id,
      skipVfsReconcile: true,
    });
    assert.equal(result.ok, true);
    assert.equal(listUserOpsLog(sessionId).length, 0);
    assert.deepEqual(sent[0]?.payload, {
      sessionId,
      attachments: [],
    });

    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });
});
