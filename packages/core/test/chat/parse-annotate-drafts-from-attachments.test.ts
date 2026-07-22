/**
 * parseAnnotateDraftsFromAttachments + build↔parse round-trip（T-UD3 部分 / Step 5）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAnnotateAttachmentFromDraft,
  buildMessageAnnotateAttachmentFromDraft,
  parseAnnotateDraftsFromAttachments,
} from "@/domain/chat/logic/build-attachment-action-xml.js";
import {
  isMessageAnnotatePath,
  type AnnotateDraft,
  type MessageAnnotateDraft,
} from "@/domain/chat/model/annotate-draft.schema.js";
import type { MessageAttachment } from "@/domain/chat/model/message-attachment.schema.js";
import { normalizePromptStorePath } from "@/domain/chat/logic/prompt-path-seen.js";

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
    const msg: MessageAnnotateDraft = {
      id: "d1",
      messageId: "m-99",
      originalText: "气泡选区",
      userAnnotation: "批一下",
    };
    const msgAtt = buildMessageAnnotateAttachmentFromDraft(msg);
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

  it("消息形 builder 伪 path round-trip 仍含 __message__:；不做破坏性 normalize", () => {
    const msg: MessageAnnotateDraft = {
      id: "draft-x",
      messageId: "msg-y",
      originalText: "原文",
      userAnnotation: "说明",
    };
    const att = buildMessageAnnotateAttachmentFromDraft(msg);
    assert.equal(att.path, "__message__:msg-y:draft-x");
    assert.equal(att.name, att.path);
    assert.ok(att.path!.includes("__message__:"));
    // 对照：若误 normalize 会变成带前导 /，但子串仍在；关键是 builder 未调用
    const normalized = normalizePromptStorePath(att.path!);
    assert.equal(normalized, "/__message__:msg-y:draft-x");
    // 落库附件保持未 normalize 的伪 path（可无前导 /）
    assert.equal(att.path, "__message__:msg-y:draft-x");
    assert.notEqual(att.path, normalized);
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
