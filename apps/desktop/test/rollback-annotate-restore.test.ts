/**
 * T-CR6 / T-UOL7：Desktop Undo 批注反投影（CR-5 闭合后按锚点角色区分）。
 *
 * 规则：
 * - user 锚点（undo_send）：保留未发送草稿，从附件重新投影
 * - assistant 锚点（rewind）：清空全部批注草稿（含未发送）
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

  it("T-UOL7: user 锚点 → annotate 附件重新投影 + 未发送草稿保留；保留 main 已推 ops", () => {
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
      // user 锚点：保留未发送草稿，并从附件重新投影
      "user",
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

  it("T-CR6: user 锚点 + 伪 __message__: path → 跳过反投影；未发送草稿保留", () => {
    // 预置一条未发送草稿，验证 user 锚点不会顺手把它清掉
    addChatAnnotateDraft("s1", {
      id: "unsent-survivor",
      path: "/keep.md",
      originalText: "未发送原文",
      userAnnotation: "未发送说明",
    });
    const msgAtt: MessageAttachmentDto = {
      name: "__message__:m-99:d1",
      source: "user_ops",
      type: "text",
      content:
        '<action name="annotate">\n{"path":"__message__:m-99:d1","messageId":"m-99","originalText":"气泡选区","userAnnotation":"批一下"}\n</action>',
      path: "__message__:m-99:d1",
      action: "annotate",
    };
    const chips = applyUndoAnnotateRestore("s1", "user", [msgAtt]);
    // __message__: 路径会被 parseAnnotateDraftsFromAttachments 跳过，但未发送草稿仍保留
    const drafts = listChatAnnotateDrafts("s1");
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.id, "unsent-survivor");
    assert.equal(chips.length, 1);
    assert.equal(chips[0]!.path, "/keep.md");
  });

  it("T-UOL7: user 锚点 + 无 annotate → store 不新增；保留 existing ops", () => {
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
      "user",
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

  it("T-UOL7: user 锚点 + 空附件 → 仅 ∪ annotate（未发送草稿保留）", () => {
    addChatAnnotateDraft("s1", {
      id: "unsent-only",
      path: "/keep.md",
      originalText: "未发送原文",
      userAnnotation: "未发送说明",
    });
    const chips = applyUndoAnnotateRestore("s1", "user", []);
    // 空附件不会新增 annotate；未发送草稿原样保留，并体现在 chip 中
    assert.deepEqual(chips, chipsFromAnnotateStore("s1"));
    assert.equal(chips.length, 1);
    assert.equal(chips[0]!.path, "/keep.md");
  });

  it("T-UOL7 rewind: assistant 锚点 → 清空全部批注草稿（含未发送）", () => {
    addChatAnnotateDraft("s1", {
      id: "ann-keep",
      path: "/note.md",
      originalText: "原文",
      userAnnotation: "批注",
    });
    // ConversationPanel rewind：assistant 锚点 + main 已推空，传空 existing 禁止盖回旧 chip
    const chips = applyUndoAnnotateRestore("s1", "assistant", null, []);
    assert.equal(
      listChatAnnotateDrafts("s1").length,
      0,
      "assistant 锚点必须清空全部批注草稿（含未发送）",
    );
    assert.equal(
      chips.length,
      0,
      "rewind 不得盖回旧非 annotate（手改）chip",
    );
  });
});
