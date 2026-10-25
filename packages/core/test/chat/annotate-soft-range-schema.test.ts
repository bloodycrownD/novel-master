/**
 * T-AR1–T-AR3：annotateDraftSchema 行列字段、build/parse 对称与旧数据兼容。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachmentXmlCodec } from "@/domain/chat/logic/attachment/attachment-xml-codec.js";
import { annotateDraftSchema, type AnnotateDraft } from "@/domain/chat/model/annotate-draft.schema.js";
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
    const att = attachmentXmlCodec.encodeAnnotateAttachment(draft);
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
    const parsed = attachmentXmlCodec.decodeAnnotateDrafts([legacyAtt]);
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
    const att = attachmentXmlCodec.encodeAnnotateAttachment(draft);
    const parsed = attachmentXmlCodec.decodeAnnotateDrafts([att]);
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

describe("T-SA1 annotateDraftSchema offset 半开语义", () => {
  it("接受合法半开 offset；缺省旧草稿仍合法", () => {
    const withOffset = annotateDraftSchema.parse({ id: "a1", path: "/ch.md", originalText: "选区", userAnnotation: "注", startOffset: 0, endOffset: 4 });
    assert.equal(withOffset.startOffset, 0);
    assert.equal(withOffset.endOffset, 4);
    const legacy = annotateDraftSchema.parse({ id: "a2", path: "/old.md", originalText: "旧", userAnnotation: "说明" });
    assert.equal(legacy.startOffset, undefined);
    assert.equal(legacy.endOffset, undefined);
  });

  it("拒绝 start≥end、非整数、负值、成对残缺", () => {
    for (const offsets of [{ startOffset: 5, endOffset: 5 }, { startOffset: 6, endOffset: 3 }, { startOffset: -1, endOffset: 3 }, { startOffset: 1.5, endOffset: 3 }, { startOffset: 1 }]) {
      assert.throws(() => annotateDraftSchema.parse({ id: "b", path: "/x.md", originalText: "t", userAnnotation: "u", ...offsets }));
    }
  });
});

describe("T-SA2 offset 与派生行列 round-trip", () => {
  it("附件携带 offset + 行列；parse 保留", () => {
    const source = "L1\nhello world\nL3\n";
    const startOffset = source.indexOf("hello");
    const endOffset = startOffset + "hello".length;
    const lines = { startLine: 2, endLine: 2, startCol: 1, endCol: 5 };
    const draft: AnnotateDraft = { id: "orig", path: "/round.md", originalText: "hello", userAnnotation: "请改", startOffset, endOffset, ...lines };
    const att = attachmentXmlCodec.encodeAnnotateAttachment(draft);
    assert.match(att.content ?? "", /"startOffset":/);
    assert.match(att.content ?? "", /"startLine":/);
    const parsed = attachmentXmlCodec.decodeAnnotateDrafts([att]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.startOffset, startOffset);
    assert.equal(parsed[0]!.endOffset, endOffset);
    assert.equal(parsed[0]!.startLine, lines.startLine);
    assert.equal(parsed[0]!.endLine, lines.endLine);
    assert.equal(parsed[0]!.startCol, 1);
    assert.equal(parsed[0]!.endCol, 5);
  });
});
