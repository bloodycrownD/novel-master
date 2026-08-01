/**
 * Desktop handlePreferencesSetUserOpsLogEnabled（M1 关闭开关清存量 pending ops）。
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  appendUserOpsLog,
  listUserOpsLog,
  resetUserOpsLogStoreForTests,
} from "@novel-master/core/chat";
import { IPC_CHANNELS } from "../shared/ipc-types.js";
import { handlePreferencesSetUserOpsLogEnabled } from "../src/main/ipc/handlers/preferences.js";
import { setComposerAttachmentsSuggestForwardTarget } from "../src/main/ipc/forward-composer-attachments-suggest.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("handlePreferencesSetUserOpsLogEnabled (M1 清存量)", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-uops-clear-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  beforeEach(() => {
    resetUserOpsLogStoreForTests();
  });

  it("把 enabled 传 false：清空存量 pending ops，并逐会话推空 Composer 广播", async () => {
    const sessionId = "s-uops-1";
    const otherSessionId = "s-uops-2";

    // 预置两个会话的存量 pending ops。
    appendUserOpsLog(sessionId, {
      id: "uol-1",
      createdAtMs: 1,
      actionXml: '<action name="mkdir">\n{"path":"/a"}\n</action>',
      action: "mkdir",
      path: "/a",
    });
    appendUserOpsLog(otherSessionId, {
      id: "uol-2",
      createdAtMs: 2,
      actionXml: '<action name="write">\n{"path":"/b"}\n</action>',
      action: "write",
      path: "/b",
    });
    assert.equal(listUserOpsLog(sessionId).length, 1);
    assert.equal(listUserOpsLog(otherSessionId).length, 1);

    // 捕获 main → renderer 的 Composer 状态条广播。
    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    const result = await handlePreferencesSetUserOpsLogEnabled(false);
    assert.equal(result.ok, true);

    // 存量 pending ops 全部清空。
    assert.equal(listUserOpsLog(sessionId).length, 0);
    assert.equal(listUserOpsLog(otherSessionId).length, 0);

    // 每个清空的会话都收到一条空 attachments 广播。
    assert.equal(sent.length, 2);
    assert.equal(
      sent[0]?.channel,
      IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST,
    );
    assert.deepEqual(sent[0]?.payload, {
      sessionId,
      attachments: [],
    });
    assert.equal(
      sent[1]?.channel,
      IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST,
    );
    assert.deepEqual(sent[1]?.payload, {
      sessionId: otherSessionId,
      attachments: [],
    });

    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });

  it("关闭开关时没有任何存量日志：idempotent，返回 ok 且不发广播", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    const result = await handlePreferencesSetUserOpsLogEnabled(false);
    assert.equal(result.ok, true);
    assert.equal(sent.length, 0);

    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });
});
