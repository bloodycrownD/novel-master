/**
 * Workplace IPC：规则保存 → refreshRuleSnapshot；差集 suggest 已废止；遗留 capture → clear kkv。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import {
  handleWorkplaceBuildListRows,
  handleWorkplaceCaptureSessionBlock,
  handleWorkplaceSetDirRule,
  handleWorkplaceSetFileRule,
} from "../src/main/ipc/handlers/workplace.js";
import {
  setComposerAttachmentsSuggestForwardTarget,
  notifyComposerAttachmentsSuggestToRenderer,
} from "../src/main/ipc/forward-composer-attachments-suggest.js";
import { IPC_CHANNELS } from "../shared/ipc-types.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("workplace ipc handlers", () => {
  let tempDir: string;
  let projectId: string;
  let sessionId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-workplace-"));

    const project = await handleProjectsCreate({ name: "workplace-ipc" });
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
    const result = await handleWorkplaceBuildListRows({
      workspaceScope: "chat",
      projectId,
      sessionId,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(Array.isArray(result.data));
    }
  });

  it("T-CR2: setDirRule → 写 rule_snapshot canon；file_cache 空；不推差集 suggest", async () => {
    const rt = await getDesktopRuntime();
    await rt.sessionKkv.set(
      sessionId,
      "file_cache",
      "full:/stale.md",
      JSON.stringify({ body: "stale", mtimeMs: 1 }),
    );

    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    const result = await handleWorkplaceSetDirRule({
      workspaceScope: "chat",
      projectId,
      sessionId,
      logicalPath: "/",
      ruleEnabled: true,
    });

    assert.equal(result.ok, true);
    const canon = await rt.sessionKkv.get(sessionId, "rule_snapshot", "canon");
    assert.ok(canon != null && canon !== "");
    assert.deepEqual(await rt.sessionKkv.listKeys(sessionId, "file_cache"), []);
    assert.equal(
      sent.filter((s) => s.channel === IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST)
        .length,
      0,
      "规则保存不得再推 workplace 差集 suggest",
    );
    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });

  it("T-CR2: setFileRule → 写 rule_snapshot；file_cache 空", async () => {
    const rt = await getDesktopRuntime();
    await rt.sessionKkv.set(
      sessionId,
      "file_cache",
      "full:/note.md",
      JSON.stringify({ body: "stale", mtimeMs: 1 }),
    );

    const result = await handleWorkplaceSetFileRule({
      workspaceScope: "chat",
      projectId,
      sessionId,
      logicalPath: "/note.md",
      inclusionMode: "show",
    });

    assert.equal(result.ok, true);
    const canon = await rt.sessionKkv.get(sessionId, "rule_snapshot", "canon");
    assert.ok(canon != null && canon !== "");
    assert.deepEqual(await rt.sessionKkv.listKeys(sessionId, "file_cache"), []);
  });

  it("composerAttachmentsSuggest 通道独立；空 attachments 仍 send（整表替换）", async () => {
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

    assert.equal(sent.length, 2);
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
    assert.deepEqual(sent[1]?.payload, {
      sessionId,
      attachments: [],
    });

    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });

  it("遗留 captureSessionBlock IPC 清空 session kkv 并推空状态条", async () => {
    const rt = await getDesktopRuntime();
    await rt.sessionKkv.set(
      sessionId,
      "file_cache",
      "full:/z.md",
      JSON.stringify({ body: "z", mtimeMs: 1 }),
    );

    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    const result = await handleWorkplaceCaptureSessionBlock({
      projectId,
      sessionId,
    });

    assert.equal(result.ok, true);
    assert.equal(
      await rt.sessionKkv.get(sessionId, "file_cache", "full:/z.md"),
      null,
    );
    assert.ok(
      sent.some(
        (s) =>
          s.channel === IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST &&
          (s.payload as { sessionId: string; attachments: unknown[] })
            .sessionId === sessionId &&
          Array.isArray(
            (s.payload as { attachments: unknown[] }).attachments,
          ) &&
          (s.payload as { attachments: unknown[] }).attachments.length === 0,
      ),
      "重置常驻缓存后应推空状态条",
    );
    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });
});
