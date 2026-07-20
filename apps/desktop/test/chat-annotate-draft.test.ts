/**
 * Desktop annotate store + 状态条 ∪（T-AN1）。
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { replaceComposerStatusAttachments } from "@novel-master/core/chat";
import {
  addChatAnnotateDraft,
  chipsFromAnnotateStore,
  clearChatAnnotateDrafts,
  listChatAnnotateDrafts,
  removeChatAnnotateDraftsByPath,
  resetChatAnnotateDraftStoreForTests,
  unionComposerStatusWithAnnotate,
} from "@/features/chat/chat-annotate-draft";
import type { MessageAttachmentDto } from "@shared/ipc-types";

afterEach(() => {
  resetChatAnnotateDraftStoreForTests();
});

function workplace(path: string): MessageAttachmentDto {
  return {
    name: path,
    source: "workplace",
    type: "text",
    content: null,
    path,
    action: "workplaceChange",
  };
}

test("T-AN1: 同 path 两条批注仅一只 chip", () => {
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
  assert.equal(chips[0]?.action, "annotate");
  assert.equal(chips[0]?.path, "/c.md");
  assert.equal(chips[0]?.source, "user_ops");
  assert.equal(listChatAnnotateDrafts(sessionId).length, 2);
});

test("T-AN1: replace projected 后再 ∪ annotate，chip 不被冲掉", () => {
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

test("T-AN1: 切会话再回来 store 未清则 chip 仍在（水化合流模拟）", () => {
  const sessionId = "s-an1-hydrate";
  addChatAnnotateDraft(sessionId, {
    id: "a1",
    path: "/persist.md",
    originalText: "a",
    userAnnotation: "b",
  });
  // 会话水化：replace([], status) 后再 ∪ annotate
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

test("T-AN3/T-AN5: started 不清；仅 clearChatAnnotateDrafts（append 推送）才清", () => {
  const sessionId = "s-an3-started";
  addChatAnnotateDraft(sessionId, {
    id: "a1",
    path: "/keep.md",
    originalText: "x",
    userAnnotation: "y",
  });
  // 模拟 ipcAgentRun ok（started:true）后仅 reproject ∪ annotate，不清 store
  const afterStarted = unionComposerStatusWithAnnotate(
    replaceComposerStatusAttachments([], [workplace("/w.md")]),
    sessionId,
  );
  assert.equal(listChatAnnotateDrafts(sessionId).length, 1);
  assert.ok(
    afterStarted.some((a) => a.action === "annotate" && a.path === "/keep.md"),
  );
  // 模拟 nm:agent/userMessageAppended
  clearChatAnnotateDrafts(sessionId);
  assert.equal(listChatAnnotateDrafts(sessionId).length, 0);
  const afterAppend = unionComposerStatusWithAnnotate(
    replaceComposerStatusAttachments([], [workplace("/w.md")]),
    sessionId,
  );
  assert.equal(
    afterAppend.some((a) => a.action === "annotate"),
    false,
  );
});

/**
 * D1：ChatComposer onUserMessageAppended 须始终 clearChatAnnotateDrafts(payload.sessionId)，
 * 即使当前 UI 已切到其它会话；仅同会话才滤 attachments UI。
 */
test("D1: append 推送按 payload.sessionId 清异会话 store，不影响当前会话", () => {
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

  // 模拟切到 viewing 后仍收到 payloadSessionId 的 append：先清 payload 会话 store
  clearChatAnnotateDrafts(payloadSessionId);
  // payload.sessionId !== viewingSessionId → 不改当前 attachments UI

  assert.equal(listChatAnnotateDrafts(payloadSessionId).length, 0);
  assert.equal(listChatAnnotateDrafts(viewingSessionId).length, 1);
});

test("T-AN2: 删光 path 后 chip 消失", () => {
  const sessionId = "s-an2";
  addChatAnnotateDraft(sessionId, {
    id: "a1",
    path: "/gone.md",
    originalText: "a",
    userAnnotation: "b",
  });
  addChatAnnotateDraft(sessionId, {
    id: "a2",
    path: "/gone.md",
    originalText: "c",
    userAnnotation: "d",
  });
  removeChatAnnotateDraftsByPath(sessionId, "/gone.md");
  assert.equal(chipsFromAnnotateStore(sessionId).length, 0);
  assert.equal(listChatAnnotateDrafts(sessionId).length, 0);
});
