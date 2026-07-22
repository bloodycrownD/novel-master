/**
 * Desktop notify-composer-status-after-kkv-clear（T-CR5）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IPC_CHANNELS } from "../shared/ipc-types.js";
import { setComposerAttachmentsSuggestForwardTarget } from "../src/main/ipc/forward-composer-attachments-suggest.js";
import {
  notifyComposerStatusAfterFloorOrCompaction,
  notifyComposerStatusAfterSessionKkvCleared,
} from "../src/main/services/notify-composer-status-after-kkv-clear.js";

describe("notify-composer-status-after-kkv-clear (T-CR5)", () => {
  it("Undo/手动：推空 attachments", async () => {
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

  it("T-CR5: 置位/压缩推 project(ops)，非强制 []", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    const rt = {
      userVfsTurn: {
        async hasPendingTurns() {
          return true;
        },
        async previewUserOpsActions() {
          return [{ action: "mkdir", path: "/keep" }];
        },
      },
    };

    await notifyComposerStatusAfterFloorOrCompaction(rt as never, "s1");
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
