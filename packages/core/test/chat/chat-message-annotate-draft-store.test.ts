/**
 * 消息正文批注草稿 store CRUD（与文件批注硬分离；不进 chip）。
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  addChatMessageAnnotateDraft,
  clearChatMessageAnnotateDrafts,
  hasChatMessageAnnotateDrafts,
  listChatMessageAnnotateDrafts,
  removeChatMessageAnnotateDraft,
  resetChatMessageAnnotateDraftStoreForTests,
  subscribeChatMessageAnnotateDraft,
  updateChatMessageAnnotateDraft,
} from "@/domain/chat/logic/chat-message-annotate-draft-store.js";
import {
  addChatAnnotateDraft,
  chipsFromAnnotateStore,
  resetChatAnnotateDraftStoreForTests,
} from "@/domain/chat/logic/chat-annotate-draft-store.js";

beforeEach(() => {
  resetChatMessageAnnotateDraftStoreForTests();
  resetChatAnnotateDraftStoreForTests();
});

describe("chat-message-annotate-draft-store", () => {
  it("CRUD + subscribe；与文件 store 隔离", () => {
    const sessionId = "s-msg";
    const events: string[] = [];
    const unsub = subscribeChatMessageAnnotateDraft((id) => {
      events.push(id);
    });

    addChatMessageAnnotateDraft(sessionId, {
      id: "m1",
      messageId: "msg-1",
      originalText: "选区",
      userAnnotation: "说明",
    });
    assert.equal(listChatMessageAnnotateDrafts(sessionId).length, 1);
    assert.equal(hasChatMessageAnnotateDrafts(sessionId), true);
    assert.deepEqual(events, [sessionId]);

    updateChatMessageAnnotateDraft(sessionId, "m1", {
      userAnnotation: "改",
    });
    assert.equal(
      listChatMessageAnnotateDrafts(sessionId).find((d) => d.id === "m1")
        ?.userAnnotation,
      "改",
    );

    removeChatMessageAnnotateDraft(sessionId, "m1");
    assert.equal(hasChatMessageAnnotateDrafts(sessionId), false);

    addChatMessageAnnotateDraft(sessionId, {
      id: "m2",
      messageId: "msg-2",
      originalText: "a",
      userAnnotation: "b",
    });
    clearChatMessageAnnotateDrafts(sessionId);
    assert.equal(listChatMessageAnnotateDrafts(sessionId).length, 0);

    unsub();
  });

  it("chip API 忽略消息批注（独立 store 不投影；伪 path 也不进 chip）", () => {
    const sessionId = "s-chip";
    addChatMessageAnnotateDraft(sessionId, {
      id: "m1",
      messageId: "msg-1",
      originalText: "x",
      userAnnotation: "y",
    });
    assert.equal(chipsFromAnnotateStore(sessionId).length, 0);

    // 防御：误写入文件 store 的伪 path 也不投影
    addChatAnnotateDraft(sessionId, {
      id: "bad",
      path: "__message__:msg-1:bad",
      originalText: "x",
      userAnnotation: "y",
    });
    addChatAnnotateDraft(sessionId, {
      id: "ok",
      path: "/real.md",
      originalText: "a",
      userAnnotation: "b",
    });
    const chips = chipsFromAnnotateStore(sessionId);
    assert.equal(chips.length, 1);
    assert.equal(chips[0]!.path, "/real.md");
  });
});
