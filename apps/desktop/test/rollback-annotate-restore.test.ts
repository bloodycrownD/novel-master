/**
 * T-CR6 / T-UOL7：Desktop Undo 批注反投影；保留 main 已推 ops，禁止 wipe。
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

describe("applyUndoAnnotateRestore (T-CR6 / T-UOL7)", () => {
  beforeEach(() => {
    resetChatAnnotateDraftStoreForTests();
  });

  it("T-UOL7: annotate 附件 → store 新 mint id + chip；与未发送并存；保留 main 已推 ops", () => {
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

    const mainPushedOps: MessageAttachmentDto[] = [
      {
        name: "/hand.md",
        source: "user_ops",
        type: "text",
        content: null,
        path: "/hand.md",
        action: "write",
      },
    ];

    const chips = applyUndoAnnotateRestore(
      "s1",
      [annotateAtt],
      mainPushedOps,
    );
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
    assert.ok(
      chips.some((c) => c.path === "/hand.md" && c.action === "write"),
      "须保留 main 已推 user_ops chip（禁止 wipe）",
    );
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

  it("T-UOL7: 无 annotate → store 不新增；保留 existing ops", () => {
    const mainOps: MessageAttachmentDto[] = [
      {
        name: "/a.md",
        source: "user_ops",
        type: "text",
        content: null,
        path: "/a.md",
        action: "mkdir",
      },
    ];
    const chips = applyUndoAnnotateRestore(
      "s1",
      [
        {
          name: "/x.md",
          source: "attach",
          type: "text",
          content: null,
          path: "/x.md",
        },
      ],
      mainOps,
    );
    assert.equal(listChatAnnotateDrafts("s1").length, 0);
    assert.equal(chips.length, 1);
    assert.equal(chips[0]?.path, "/a.md");
    assert.equal(chips[0]?.action, "mkdir");
  });

  it("T-UOL7: 禁止 union([],…) — 无 existing 时仅 annotate chip", () => {
    const chips = applyUndoAnnotateRestore("s1", []);
    assert.deepEqual(chips, chipsFromAnnotateStore("s1"));
    assert.deepEqual(chips, []);
  });
});
