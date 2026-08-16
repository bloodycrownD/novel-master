/**
 * T-UO4：Desktop main handleMessagesRollback — undo_send / rewind 均清 main 侧 annotate store 并推空。
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  addChatAnnotateDraft,
  listChatAnnotateDrafts,
  resetChatAnnotateDraftStoreForTests,
  textBlocks,
} from "@novel-master/core/chat";
import { IPC_CHANNELS } from "../shared/ipc-types.js";
import { setComposerAttachmentsSuggestForwardTarget } from "../src/main/ipc/forward-composer-attachments-suggest.js";
import {
  handleMessagesRollback,
} from "../src/main/ipc/handlers/messages.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleAgentRegistryCreateBlank } from "../src/main/ipc/handlers/agent-registry.js";
import { handleAgentSetCurrent } from "../src/main/ipc/handlers/agent.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("handleMessagesRollback (T-UO4 / D8)", () => {
  let tempDir: string;
  let projectId: string;

  beforeEach(() => {
    resetChatAnnotateDraftStoreForTests();
  });

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-rollback-uol-"));
    const project = await handleProjectsCreate({ name: "rollback-uol" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;

    // 新 core 下 session 创建要求 workspace 已配置 agent。
    const blank = await handleAgentRegistryCreateBlank();
    assert.equal(blank.ok, true);
    if (blank.ok) {
      await handleAgentSetCurrent({ agentId: blank.data.agentId });
    }
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  async function createSession(title: string): Promise<string> {
    const session = await handleSessionsCreate({ projectId, title });
    assert.equal(session.ok, true);
    if (!session.ok) {
      throw new Error("failed to create session");
    }
    return session.data.id;
  }

  it("T-UO4 undo_send: rollback 后清 main 侧 annotate store 并 COMPOSER_ATTACHMENTS_SUGGEST 推空", async () => {
    const sessionId = await createSession("undo-send");
    const rt = await getDesktopRuntime();
    const annotateActionXml =
      '<action name="annotate">\n{"path":"/a.md","originalText":"原文","userAnnotation":"批一下"}\n</action>';
    const msg = await rt.messages.append(
      sessionId,
      "user",
      textBlocks("请看看"),
      {
        attachments: [
          {
            name: "/a.md",
            source: "user_ops",
            type: "text",
            content: annotateActionXml,
            path: "/a.md",
            action: "annotate",
          },
        ],
      },
    );

    // main 进程预置一条未发送批注草稿（renderer 侧另有独立 store，此处只验 main 半边）
    addChatAnnotateDraft(sessionId, {
      id: "a-unsent",
      path: "/keep.md",
      originalText: "foo",
      userAnnotation: "note",
    });
    assert.equal(listChatAnnotateDrafts(sessionId).length, 1);

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

    assert.equal(listChatAnnotateDrafts(sessionId).length, 0);

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.channel, IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST);
    assert.deepEqual(sent[0]?.payload, {
      sessionId,
      attachments: [],
    });

    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });

  it("T-UO4 rewind: rollback 后 main 侧 annotate store 清空、推空", async () => {
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
    );
    void userMsg;

    addChatAnnotateDraft(sessionId, {
      id: "a-unsent",
      path: "/keep.md",
      originalText: "foo",
      userAnnotation: "note",
    });
    assert.equal(listChatAnnotateDrafts(sessionId).length, 1);

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
    assert.equal(listChatAnnotateDrafts(sessionId).length, 0);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]?.payload, {
      sessionId,
      attachments: [],
    });

    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });
});
