/**
 * T-UOL7：Desktop main handleMessagesRollback — undo_send parse→main store→推 ops；rewind 不 parse。
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
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

  it("T-UOL7 undo_send: truncate 后 parse 写 main log store 并 COMPOSER_ATTACHMENTS_SUGGEST 推 ops", async () => {
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

    const entries = listUserOpsLog(sessionId);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.action, "write");
    assert.equal(entries[0]?.path, "/hand.md");

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.channel, IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST);
    const payload = sent[0]?.payload as {
      sessionId: string;
      attachments: Array<{ path?: string; action?: string }>;
    };
    assert.equal(payload.sessionId, sessionId);
    assert.ok(
      payload.attachments.some(
        (a) => a.path === "/hand.md" && a.action === "write",
      ),
    );

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
});
