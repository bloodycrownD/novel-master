/**
 * Desktop notify-composer-status-after-kkv-clear（T-CR5 / T-UO4）。
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  addChatAnnotateDraft,
  resetChatAnnotateDraftStoreForTests,
} from "@novel-master/core/chat";
import { IPC_CHANNELS } from "../shared/ipc-types.js";
import { setComposerAttachmentsSuggestForwardTarget } from "../src/main/ipc/forward-composer-attachments-suggest.js";
import {
  notifyComposerStatusAfterFloorOrCompaction,
  notifyComposerStatusAfterSessionKkvCleared,
} from "../src/main/services/notify-composer-status-after-kkv-clear.js";

describe("notify-composer-status-after-kkv-clear (T-CR5)", () => {
  beforeEach(() => {
    resetChatAnnotateDraftStoreForTests();
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

  it("T-UO4: 置位/压缩推 annotate store 投影（按 path 去重）；无草稿推空", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    addChatAnnotateDraft("s1", {
      id: "a1",
      path: "/keep.md",
      originalText: "foo",
      userAnnotation: "note1",
    });
    addChatAnnotateDraft("s1", {
      id: "a2",
      path: "/keep.md",
      originalText: "bar",
      userAnnotation: "note2",
    });
    addChatAnnotateDraft("s1", {
      id: "a3",
      path: "/other.md",
      originalText: "baz",
      userAnnotation: "note3",
    });

    await notifyComposerStatusAfterFloorOrCompaction({} as never, "s1");
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.channel, IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST);
    assert.deepEqual(sent[0]?.payload, {
      sessionId: "s1",
      attachments: [
        {
          name: "/keep.md",
          source: "user_ops",
          type: "text",
          content: null,
          path: "/keep.md",
          action: "annotate",
        },
        {
          name: "/other.md",
          source: "user_ops",
          type: "text",
          content: null,
          path: "/other.md",
          action: "annotate",
        },
      ],
    });

    // 清空 store 后再推 → 空 attachments（D7 收窄口径）
    resetChatAnnotateDraftStoreForTests();
    await notifyComposerStatusAfterFloorOrCompaction({} as never, "s1");
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1]?.payload, {
      sessionId: "s1",
      attachments: [],
    });

    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });
});
