/**
 * T-CR6：Desktop Undo 批注反投影（对齐 Mobile；不恢复手改）。
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  buildAnnotateAttachmentFromDraft,
  chipsFromAnnotateStore,
  listChatAnnotateDrafts,
  resetChatAnnotateDraftStoreForTests,
  addChatAnnotateDraft,
} from "@shared/logic/chat";
import type { MessageAttachmentDto } from "@shared/ipc-types";
import { applyUndoAnnotateRestore } from "@/features/chat/rollback-annotate-restore";

describe("applyUndoAnnotateRestore (T-CR6)", () => {
  beforeEach(() => {
    resetChatAnnotateDraftStoreForTests();
  });

  it("T-CR6: annotate 附件 → store 新 mint id + chip；与未发送并存；无手改 chip", () => {
    addChatAnnotateDraft("s1", {
      id: "unsent-keep",
      path: "/keep.md",
      originalText: "未发送原文",
      userAnnotation: "未发送说明",
    });
    const annotateAtt = buildAnnotateAttachmentFromDraft({
      id: "sent-ann",
      path: "/chapter/a.md",
      originalText: "选中原文",
      userAnnotation: "请改短",
    }) as MessageAttachmentDto;

    const chips = applyUndoAnnotateRestore("s1", [annotateAtt]);
    const drafts = listChatAnnotateDrafts("s1");
    assert.equal(drafts.length, 2);
    assert.ok(
      drafts.some((d) => d.id === "unsent-keep" && d.path === "/keep.md"),
    );
    const restored = drafts.find((d) => d.path === "/chapter/a.md");
    assert.ok(restored);
    assert.equal(restored!.originalText, "选中原文");
    assert.equal(restored!.userAnnotation, "请改短");
    assert.notEqual(restored!.id, "sent-ann");

    assert.ok(
      chips.some((c) => c.path === "/chapter/a.md" && c.action === "annotate"),
    );
    assert.ok(
      chips.some((c) => c.path === "/keep.md" && c.action === "annotate"),
    );
    assert.equal(
      chips.some((c) => c.action === "mkdir" || c.action === "write"),
      false,
      "手改 chip 不得出现",
    );
    assert.deepEqual(chipsFromAnnotateStore("s1"), chips);
  });

  it("T-CR6: 伪 __message__: path 跳过", () => {
    const msgAtt: MessageAttachmentDto = {
      name: "__message__:m-99:d1",
      source: "user_ops",
      type: "text",
      content:
        '<action name="annotate">\n{"path":"__message__:m-99:d1","messageId":"m-99","originalText":"气泡选区","userAnnotation":"批一下"}\n</action>',
      path: "__message__:m-99:d1",
      action: "annotate",
    };
    const chips = applyUndoAnnotateRestore("s1", [msgAtt]);
    assert.equal(listChatAnnotateDrafts("s1").length, 0);
    assert.equal(chips.length, 0);
  });

  it("T-CR6: 无 annotate → store 不新增；状态条空（ops 半边空）", () => {
    const chips = applyUndoAnnotateRestore("s1", [
      {
        name: "/a.md",
        source: "attach",
        type: "text",
        content: null,
        path: "/a.md",
      },
    ]);
    assert.equal(listChatAnnotateDrafts("s1").length, 0);
    assert.deepEqual(chips, []);
  });
});
