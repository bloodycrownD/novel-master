/**
 * parseAnnotateDraftsFromAttachments + build↔parse round-trip（T-UD3 部分 / Step 5）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAnnotateAttachmentFromDraft,
  parseAnnotateDraftsFromAttachments,
} from "@/domain/chat/logic/build-attachment-action-xml.js";
import {
  isMessageAnnotatePath,
  type AnnotateDraft,
} from "@/domain/chat/model/annotate-draft.schema.js";
import type { MessageAttachment } from "@/domain/chat/model/message-attachment.schema.js";

/** 手工构造历史消息批注伪 path 附件（发送管线已移除消息形 builder）。 */
function fakeMessageAnnotateAttachment(
  messageId: string,
  draftId: string,
): MessageAttachment {
  const path = `__message__:${messageId}:${draftId}`;
  return {
    name: path,
    source: "user_ops",
    type: "text",
    content: `<action name="annotate">\n${JSON.stringify(
      {
        path,
        messageId,
        originalText: "原文",
        userAnnotation: "说明",
      },
      null,
      2,
    )}\n</action>`,
    path,
    action: "annotate",
  };
}

describe("parseAnnotateDraftsFromAttachments (T-UD3 部分)", () => {
  it("build↔parse round-trip：真 VFS path；新 mint id", () => {
    const draft: AnnotateDraft = {
      id: "orig-id",
      path: "/chapter/a.md",
      originalText: "选中原文",
      userAnnotation: "请改短",
    };
    const att = buildAnnotateAttachmentFromDraft(draft);
    const parsed = parseAnnotateDraftsFromAttachments([att]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.path, "/chapter/a.md");
    assert.equal(parsed[0]!.originalText, "选中原文");
    assert.equal(parsed[0]!.userAnnotation, "请改短");
    assert.notEqual(parsed[0]!.id, "orig-id", "须新 mint id");
    assert.match(parsed[0]!.id, /^ann-/);
  });

  it("跳过 path.includes('__message__:')（含前导 /）", () => {
    const msgAtt = fakeMessageAnnotateAttachment("m-99", "d1");
    assert.ok(isMessageAnnotatePath(msgAtt.path));
    assert.ok(msgAtt.path!.includes("__message__:"));

    const withSlash: MessageAttachment = {
      ...msgAtt,
      path: `/${msgAtt.path}`,
      name: `/${msgAtt.path}`,
    };
    assert.ok(isMessageAnnotatePath(withSlash.path));

    const parsed = parseAnnotateDraftsFromAttachments([
      msgAtt,
      withSlash,
      buildAnnotateAttachmentFromDraft({
        id: "f1",
        path: "/ok.md",
        originalText: "a",
        userAnnotation: "b",
      }),
    ]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.path, "/ok.md");
  });

  it("历史伪 path 手工附件仍含 __message__: 子串；Undo parse 跳过", () => {
    const att = fakeMessageAnnotateAttachment("msg-y", "draft-x");
    assert.equal(att.path, "__message__:msg-y:draft-x");
    assert.equal(att.name, att.path);
    assert.ok(isMessageAnnotatePath(att.path));
    assert.equal(parseAnnotateDraftsFromAttachments([att]).length, 0);
  });

  it("非 annotate / 空 path 跳过", () => {
    const parsed = parseAnnotateDraftsFromAttachments([
      {
        name: "/a.md",
        source: "attach",
        type: "text",
        content: null,
        path: "/a.md",
        action: "userAttach",
      },
      {
        name: "__no_path__",
        source: "user_ops",
        type: "text",
        content: '<action name="annotate">\n{"originalText":"x","userAnnotation":"y"}\n</action>',
        action: "annotate",
      },
    ]);
    assert.equal(parsed.length, 0);
  });
});
