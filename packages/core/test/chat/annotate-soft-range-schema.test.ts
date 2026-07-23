/**
 * T-AR1–T-AR3：annotateDraftSchema 行列字段、build/parse 对称与旧数据兼容。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFileAnnotateAttachmentFromDraft,
  parseAnnotateDraftsFromAttachments,
} from "@/domain/chat/logic/build-attachment-action-xml.js";
import {
  annotateDraftSchema,
  type AnnotateDraft,
} from "@/domain/chat/model/annotate-draft.schema.js";
import type { MessageAttachment } from "@/domain/chat/model/message-attachment.schema.js";

describe("T-AR1 annotateDraftSchema 行列 decode/encode", () => {
  it("带行列的草稿合法；缺行列旧 JSON 仍合法；strict 拒未知键", () => {
    const withRange = annotateDraftSchema.parse({
      id: "a1",
      path: "/ch.md",
      originalText: "选区",
      userAnnotation: "注",
      startLine: 3,
      endLine: 7,
      startCol: 2,
      endCol: 8,
    });
    assert.equal(withRange.startLine, 3);
    assert.equal(withRange.endLine, 7);
    assert.equal(withRange.startCol, 2);
    assert.equal(withRange.endCol, 8);

    const legacy = annotateDraftSchema.parse({
      id: "a2",
      path: "/old.md",
      originalText: "旧",
      userAnnotation: "说明",
    });
    assert.equal(legacy.startLine, undefined);
    assert.equal(legacy.endLine, undefined);

    assert.throws(() =>
      annotateDraftSchema.parse({
        id: "a3",
        path: "/x.md",
        originalText: "t",
        userAnnotation: "u",
        extra: true,
      }),
    );
  });
});

describe("T-AR2 buildFileAnnotateAttachmentFromDraft 行列键", () => {
  it("XML 含行列键；旧三字段附件 parse 不挂", () => {
    const draft: AnnotateDraft = {
      id: "d1",
      path: "/a.md",
      originalText: "原文",
      userAnnotation: "批",
      startLine: 10,
      endLine: 14,
      startCol: 1,
      endCol: 5,
    };
    const att = buildFileAnnotateAttachmentFromDraft(draft);
    assert.match(att.content ?? "", /"startLine": 10/);
    assert.match(att.content ?? "", /"endLine": 14/);
    assert.match(att.content ?? "", /"startCol": 1/);
    assert.match(att.content ?? "", /"endCol": 5/);

    const legacyAtt: MessageAttachment = {
      name: "/legacy.md",
      source: "user_ops",
      type: "text",
      content:
        '<action name="annotate">\n{"path":"/legacy.md","originalText":"三字段","userAnnotation":"旧"}\n</action>',
      path: "/legacy.md",
      action: "annotate",
    };
    const parsed = parseAnnotateDraftsFromAttachments([legacyAtt]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.path, "/legacy.md");
    assert.equal(parsed[0]!.originalText, "三字段");
    assert.equal(parsed[0]!.startLine, undefined);
    assert.equal(parsed[0]!.endLine, undefined);
  });
});

describe("T-AR3 Undo parse round-trip 保留行列", () => {
  it("build↔parse 保留 startLine/endLine/startCol/endCol；新 mint id", () => {
    const draft: AnnotateDraft = {
      id: "orig",
      path: "/round.md",
      originalText: "多行\n原文",
      userAnnotation: "请改",
      startLine: 2,
      endLine: 6,
      startCol: 3,
      endCol: 4,
    };
    const att = buildFileAnnotateAttachmentFromDraft(draft);
    const parsed = parseAnnotateDraftsFromAttachments([att]);
    assert.equal(parsed.length, 1);
    assert.notEqual(parsed[0]!.id, "orig");
    assert.equal(parsed[0]!.path, "/round.md");
    assert.equal(parsed[0]!.originalText, "多行\n原文");
    assert.equal(parsed[0]!.userAnnotation, "请改");
    assert.equal(parsed[0]!.startLine, 2);
    assert.equal(parsed[0]!.endLine, 6);
    assert.equal(parsed[0]!.startCol, 3);
    assert.equal(parsed[0]!.endCol, 4);
  });
});
