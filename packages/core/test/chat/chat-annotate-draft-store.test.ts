/**
 * 批注草稿进程内 store（迁并双端 T-AN*；T-X2-3）。
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { chatAnnotateDraftStore } from "../../src/domain/chat/logic/chat-annotate-draft-store.js";
import type { MessageAttachment } from "../../src/domain/chat/model/message-attachment.schema.js";

afterEach(() => {
  chatAnnotateDraftStore.resetForTests();
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
    chatAnnotateDraftStore.add(sessionId, {
      id: "a1",
      path: "/c.md",
      originalText: "foo",
      userAnnotation: "note1",
    });
    chatAnnotateDraftStore.add(sessionId, {
      id: "a2",
      path: "/c.md",
      originalText: "bar",
      userAnnotation: "note2",
    });
    const chips = chatAnnotateDraftStore.chips(sessionId);
    assert.equal(chips.length, 1);
    assert.deepEqual(chips[0], {
      name: "/c.md",
      source: "user_ops",
      type: "text",
      content: null,
      path: "/c.md",
      action: "annotate",
    });
    assert.equal(chatAnnotateDraftStore.list(sessionId).length, 2);
  });

  it("T-X2-3/T-AN1: workplace 状态 ∪ annotate，chip 不被冲掉", () => {
    const sessionId = "s-an1-union";
    chatAnnotateDraftStore.add(sessionId, {
      id: "a1",
      path: "/keep.md",
      originalText: "x",
      userAnnotation: "y",
    });
    const merged = chatAnnotateDraftStore.union(
      [workplace("/new.md")],
      sessionId,
    );
    assert.deepEqual(
      merged.map((a) => `${a.action}:${a.path}`),
      ["workplaceChange:/new.md", "annotate:/keep.md"],
    );
  });

  it("T-X2-3: 切会话再回来 store 未清则 chip 仍在", () => {
    const sessionId = "s-an1-hydrate";
    chatAnnotateDraftStore.add(sessionId, {
      id: "a1",
      path: "/persist.md",
      originalText: "a",
      userAnnotation: "b",
    });
    const hydrated = chatAnnotateDraftStore.union(
      [workplace("/w.md")],
      sessionId,
    );
    assert.ok(
      hydrated.some((a) => a.action === "annotate" && a.path === "/persist.md"),
    );
    chatAnnotateDraftStore.clear(sessionId);
    const afterClear = chatAnnotateDraftStore.union(
      [workplace("/w.md")],
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
    chatAnnotateDraftStore.add(payloadSessionId, {
      id: "a-src",
      path: "/src.md",
      originalText: "a",
      userAnnotation: "b",
    });
    chatAnnotateDraftStore.add(viewingSessionId, {
      id: "a-view",
      path: "/view.md",
      originalText: "c",
      userAnnotation: "d",
    });
    chatAnnotateDraftStore.clear(payloadSessionId);
    assert.equal(chatAnnotateDraftStore.list(payloadSessionId).length, 0);
    assert.equal(chatAnnotateDraftStore.list(viewingSessionId).length, 1);
    assert.equal(chatAnnotateDraftStore.has(viewingSessionId), true);
  });

  it("T-X2-3/T-AN2: 删光 path 后 chip 消失；update/remove 按 id", () => {
    const sessionId = "s-an2";
    chatAnnotateDraftStore.add(sessionId, {
      id: "a1",
      path: "/gone.md",
      originalText: "a",
      userAnnotation: "b",
    });
    chatAnnotateDraftStore.add(sessionId, {
      id: "a2",
      path: "/keep.md",
      originalText: "c",
      userAnnotation: "d",
    });
    chatAnnotateDraftStore.update(sessionId, "a2", {
      userAnnotation: "d2",
      originalText: "c2",
    });
    assert.equal(
      chatAnnotateDraftStore.list(sessionId).find((d) => d.id === "a2")
        ?.userAnnotation,
      "d2",
    );
    assert.equal(
      chatAnnotateDraftStore.list(sessionId).find((d) => d.id === "a2")
        ?.originalText,
      "c2",
    );
    chatAnnotateDraftStore.remove(sessionId, "a2");
    assert.equal(chatAnnotateDraftStore.list(sessionId).length, 1);
    chatAnnotateDraftStore.remove(sessionId, "a1");
    assert.equal(chatAnnotateDraftStore.chips(sessionId).length, 0);
    assert.equal(chatAnnotateDraftStore.has(sessionId), false);
  });

  it("T-X2-3: subscribe 通知；resetForTests 清空全部会话", () => {
    const seen: string[] = [];
    const unsub = chatAnnotateDraftStore.subscribe((id) => {
      seen.push(id);
    });
    chatAnnotateDraftStore.add("s-a", {
      id: "1",
      path: "/a.md",
      originalText: "x",
      userAnnotation: "y",
    });
    chatAnnotateDraftStore.add("s-b", {
      id: "2",
      path: "/b.md",
      originalText: "x",
      userAnnotation: "y",
    });
    assert.deepEqual(seen, ["s-a", "s-b"]);
    unsub();
    chatAnnotateDraftStore.resetForTests();
    assert.equal(chatAnnotateDraftStore.list("s-a").length, 0);
    assert.equal(chatAnnotateDraftStore.list("s-b").length, 0);
  });
});
