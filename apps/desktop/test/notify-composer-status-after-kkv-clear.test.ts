/**
 * Desktop notify-composer-status-after-kkv-clear（T-CR5 / T-UOL8）。
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  appendUserOpsLog,
  resetUserOpsLogStoreForTests,
} from "@novel-master/core/chat";
import { IPC_CHANNELS } from "../shared/ipc-types.js";
import { setComposerAttachmentsSuggestForwardTarget } from "../src/main/ipc/forward-composer-attachments-suggest.js";
import {
  notifyComposerStatusAfterFloorOrCompaction,
  notifyComposerStatusAfterSessionKkvCleared,
} from "../src/main/services/notify-composer-status-after-kkv-clear.js";

describe("notify-composer-status-after-kkv-clear (T-CR5)", () => {
  beforeEach(() => {
    resetUserOpsLogStoreForTests();
  });

  it("Undo rewind/手动：推空 attachments", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    await notifyComposerStatusAfterSessionKkvCleared({} as never, "s1");
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.channel, IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST);
    assert.deepEqual(sent[0]?.payload, { sessionId: "s1", attachments: [] });

    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });

  it("T-CR5/T-UOL8: 置位/压缩推 project(ops)（读 main log store），非强制 []", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    appendUserOpsLog("s1", {
      id: "uol-keep",
      createdAtMs: 1,
      actionXml: '<action name="mkdir">\n{"path":"/keep"}\n</action>',
      action: "mkdir",
      path: "/keep",
    });

    await notifyComposerStatusAfterFloorOrCompaction({} as never, "s1");
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.channel, IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST);
    assert.deepEqual(sent[0]?.payload, {
      sessionId: "s1",
      attachments: [
        {
          name: "/keep",
          source: "user_ops",
          type: "text",
          content: null,
          path: "/keep",
          action: "mkdir",
        },
      ],
    });

    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });
});
