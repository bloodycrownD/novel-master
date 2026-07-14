/**
 * Worktree IPC：规则保存不 capture；差集经 composerAttachmentsSuggest；遗留 capture → clear kkv。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import {
  handleWorktreeBuildListRows,
  handleWorktreeCaptureSessionBlock,
  handleWorktreeSetDirRule,
  handleWorktreeSetFileRule,
} from "../src/main/ipc/handlers/worktree.js";
import {
  setComposerAttachmentsSuggestForwardTarget,
  notifyComposerAttachmentsSuggestToRenderer,
} from "../src/main/ipc/forward-composer-attachments-suggest.js";
import { IPC_CHANNELS } from "../shared/ipc-types.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("worktree ipc handlers", () => {
  let tempDir: string;
  let projectId: string;
  let sessionId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-worktree-"));

    const project = await handleProjectsCreate({ name: "worktree-ipc" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;

    const session = await handleSessionsCreate({
      projectId,
      title: "session-1",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    sessionId = session.data.id;
  });

  after(async () => {
    setComposerAttachmentsSuggestForwardTarget(() => undefined);
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("session buildListRows 成功", async () => {
    const result = await handleWorktreeBuildListRows({
      workspaceScope: "chat",
      projectId,
      sessionId,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(Array.isArray(result.data));
    }
  });

  it("setDirRule 成功且不写 file_cache（无 capture）", async () => {
    const rt = await getDesktopRuntime();
    const keysBefore = await rt.sessionKkv.listKeys(sessionId, "file_cache");

    const result = await handleWorktreeSetDirRule({
      workspaceScope: "chat",
      projectId,
      sessionId,
      logicalPath: "/",
      ruleEnabled: true,
    });

    assert.equal(result.ok, true);
    const keysAfter = await rt.sessionKkv.listKeys(sessionId, "file_cache");
    assert.deepEqual(keysAfter, keysBefore);
  });

  it("setFileRule 成功且不写 file_cache（无 capture）", async () => {
    const rt = await getDesktopRuntime();
    const keysBefore = await rt.sessionKkv.listKeys(sessionId, "file_cache");

    const result = await handleWorktreeSetFileRule({
      workspaceScope: "chat",
      projectId,
      sessionId,
      logicalPath: "/note.md",
      inclusionMode: "show",
    });

    assert.equal(result.ok, true);
    const keysAfter = await rt.sessionKkv.listKeys(sessionId, "file_cache");
    assert.deepEqual(keysAfter, keysBefore);
  });

  it("composerAttachmentsSuggest 通道独立；空 attachments 不 send", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    notifyComposerAttachmentsSuggestToRenderer({
      sessionId,
      attachments: [
        {
          name: "/x.md",
          source: "workplace",
          type: "text",
          content: null,
          path: "/x.md",
        },
      ],
    });
    notifyComposerAttachmentsSuggestToRenderer({
      sessionId,
      attachments: [],
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.channel, IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST);
    assert.deepEqual(sent[0]?.payload, {
      sessionId,
      attachments: [
        {
          name: "/x.md",
          source: "workplace",
          type: "text",
          content: null,
          path: "/x.md",
        },
      ],
    });

    const result = await handleWorktreeSetDirRule({
      workspaceScope: "chat",
      projectId,
      sessionId,
      logicalPath: "/",
      ruleEnabled: true,
    });
    assert.equal(result.ok, true);
    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });

  it("遗留 captureSessionBlock IPC 清空 session kkv（非 BlockStore）", async () => {
    const rt = await getDesktopRuntime();
    await rt.sessionKkv.set(
      sessionId,
      "file_cache",
      "full:/z.md",
      JSON.stringify({ body: "z", mtimeMs: 1 }),
    );

    const result = await handleWorktreeCaptureSessionBlock({
      projectId,
      sessionId,
    });

    assert.equal(result.ok, true);
    assert.equal(
      await rt.sessionKkv.get(sessionId, "file_cache", "full:/z.md"),
      null,
    );
  });
});
