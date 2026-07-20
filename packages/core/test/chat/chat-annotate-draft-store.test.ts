/**
 * 批注草稿进程内 store（迁并双端 T-AN*；T-X2-3）。
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { replaceComposerStatusAttachments } from "../../src/domain/chat/logic/project-composer-status-attachments.js";
import {
  addChatAnnotateDraft,
  chipsFromAnnotateStore,
  clearChatAnnotateDrafts,
  hasChatAnnotateDrafts,
  listChatAnnotateDrafts,
  removeChatAnnotateDraft,
  removeChatAnnotateDraftsByPath,
  resetChatAnnotateDraftStoreForTests,
  subscribeChatAnnotateDraft,
  unionComposerStatusWithAnnotate,
  updateChatAnnotateDraft,
} from "../../src/domain/chat/logic/chat-annotate-draft-store.js";
import type { MessageAttachment } from "../../src/domain/chat/model/message-attachment.schema.js";

afterEach(() => {
  resetChatAnnotateDraftStoreForTests();
});

function workplace(path: string): MessageAttachment {
  return {
    name: path,
    source: "workplace",
    type: "text",
    content: null,
    path,
    action: "workplaceChange",
  };
}

describe("chat-annotate-draft-store", () => {
  it("T-X2-3/T-AN1: 同 path 两条批注仅一只 chip；字段对齐 domain MessageAttachment", () => {
    const sessionId = "s-an1-agg";
    addChatAnnotateDraft(sessionId, {
      id: "a1",
      path: "/c.md",
      originalText: "foo",
      userAnnotation: "note1",
    });
    addChatAnnotateDraft(sessionId, {
      id: "a2",
      path: "/c.md",
      originalText: "bar",
      userAnnotation: "note2",
    });
    const chips = chipsFromAnnotateStore(sessionId);
    assert.equal(chips.length, 1);
    assert.deepEqual(chips[0], {
      name: "/c.md",
      source: "user_ops",
      type: "text",
      content: null,
      path: "/c.md",
      action: "annotate",
    });
    assert.equal(listChatAnnotateDrafts(sessionId).length, 2);
  });

  it("T-X2-3/T-AN1: replace projected 后再 ∪ annotate，chip 不被冲掉", () => {
    const sessionId = "s-an1-union";
    addChatAnnotateDraft(sessionId, {
      id: "a1",
      path: "/keep.md",
      originalText: "x",
      userAnnotation: "y",
    });
    const replaced = replaceComposerStatusAttachments(
      [workplace("/old.md")],
      [workplace("/new.md")],
    );
    const merged = unionComposerStatusWithAnnotate(replaced, sessionId);
    assert.deepEqual(
      merged.map((a) => `${a.action}:${a.path}`),
      ["workplaceChange:/new.md", "annotate:/keep.md"],
    );
  });

  it("T-X2-3: 切会话再回来 store 未清则 chip 仍在", () => {
    const sessionId = "s-an1-hydrate";
    addChatAnnotateDraft(sessionId, {
      id: "a1",
      path: "/persist.md",
      originalText: "a",
      userAnnotation: "b",
    });
    const hydrated = unionComposerStatusWithAnnotate(
      replaceComposerStatusAttachments([], [workplace("/w.md")]),
      sessionId,
    );
    assert.ok(
      hydrated.some((a) => a.action === "annotate" && a.path === "/persist.md"),
    );
    clearChatAnnotateDrafts(sessionId);
    const afterClear = unionComposerStatusWithAnnotate(
      replaceComposerStatusAttachments([], [workplace("/w.md")]),
      sessionId,
    );
    assert.equal(
      afterClear.some((a) => a.action === "annotate"),
      false,
    );
  });

  it("T-X2-3: append 按 sessionId 清异会话；不影响当前会话", () => {
    const payloadSessionId = "s-append-source";
    const viewingSessionId = "s-viewing";
    addChatAnnotateDraft(payloadSessionId, {
      id: "a-src",
      path: "/src.md",
      originalText: "a",
      userAnnotation: "b",
    });
    addChatAnnotateDraft(viewingSessionId, {
      id: "a-view",
      path: "/view.md",
      originalText: "c",
      userAnnotation: "d",
    });
    clearChatAnnotateDrafts(payloadSessionId);
    assert.equal(listChatAnnotateDrafts(payloadSessionId).length, 0);
    assert.equal(listChatAnnotateDrafts(viewingSessionId).length, 1);
    assert.equal(hasChatAnnotateDrafts(viewingSessionId), true);
  });

  it("T-X2-3/T-AN2: 删光 path 后 chip 消失；update/remove 按 id", () => {
    const sessionId = "s-an2";
    addChatAnnotateDraft(sessionId, {
      id: "a1",
      path: "/gone.md",
      originalText: "a",
      userAnnotation: "b",
    });
    addChatAnnotateDraft(sessionId, {
      id: "a2",
      path: "/keep.md",
      originalText: "c",
      userAnnotation: "d",
    });
    updateChatAnnotateDraft(sessionId, "a2", {
      userAnnotation: "d2",
      originalText: "c2",
    });
    assert.equal(
      listChatAnnotateDrafts(sessionId).find((d) => d.id === "a2")
        ?.userAnnotation,
      "d2",
    );
    assert.equal(
      listChatAnnotateDrafts(sessionId).find((d) => d.id === "a2")
        ?.originalText,
      "c2",
    );
    removeChatAnnotateDraft(sessionId, "a2");
    assert.equal(listChatAnnotateDrafts(sessionId).length, 1);
    removeChatAnnotateDraftsByPath(sessionId, "/gone.md");
    assert.equal(chipsFromAnnotateStore(sessionId).length, 0);
    assert.equal(hasChatAnnotateDrafts(sessionId), false);
  });

  it("T-X2-3: subscribe 通知；resetForTests 清空全部会话", () => {
    const seen: string[] = [];
    const unsub = subscribeChatAnnotateDraft((id) => {
      seen.push(id);
    });
    addChatAnnotateDraft("s-a", {
      id: "1",
      path: "/a.md",
      originalText: "x",
      userAnnotation: "y",
    });
    addChatAnnotateDraft("s-b", {
      id: "2",
      path: "/b.md",
      originalText: "x",
      userAnnotation: "y",
    });
    assert.deepEqual(seen, ["s-a", "s-b"]);
    unsub();
    resetChatAnnotateDraftStoreForTests();
    assert.equal(listChatAnnotateDrafts("s-a").length, 0);
    assert.equal(listChatAnnotateDrafts("s-b").length, 0);
  });
});
