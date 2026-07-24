/**
 * T-RG1：annotateDraftSchema `renderStart`/`renderEnd` 半开语义、XML 对称、缺省旧草稿兼容。
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
import * as publicChat from "@novel-master/core/chat";

describe("T-RG1 annotateDraftSchema renderStart/renderEnd", () => {
  it("接受合法半开渲染坐标；缺省旧草稿仍合法", () => {
    const withRender = annotateDraftSchema.parse({
      id: "r1",
      path: "/ch.md",
      originalText: "选区",
      userAnnotation: "注",
      renderStart: 0,
      renderEnd: 4,
    });
    assert.equal(withRender.renderStart, 0);
    assert.equal(withRender.renderEnd, 4);

    const legacy = annotateDraftSchema.parse({
      id: "r2",
      path: "/old.md",
      originalText: "旧",
      userAnnotation: "说明",
      startOffset: 10,
      endOffset: 14,
    });
    assert.equal(legacy.renderStart, undefined);
    assert.equal(legacy.renderEnd, undefined);
    assert.equal(legacy.startOffset, 10);
    assert.equal(legacy.endOffset, 14);

    const bare = annotateDraftSchema.parse({
      id: "r3",
      path: "/bare.md",
      originalText: "三字段",
      userAnnotation: "旧",
    });
    assert.equal(bare.renderStart, undefined);
    assert.equal(bare.renderEnd, undefined);
  });

  it("拒绝 start≥end、非整数、负值、成对残缺", () => {
    assert.throws(() =>
      annotateDraftSchema.parse({
        id: "b1",
        path: "/x.md",
        originalText: "t",
        userAnnotation: "u",
        renderStart: 5,
        renderEnd: 5,
      }),
    );
    assert.throws(() =>
      annotateDraftSchema.parse({
        id: "b2",
        path: "/x.md",
        originalText: "t",
        userAnnotation: "u",
        renderStart: 6,
        renderEnd: 3,
      }),
    );
    assert.throws(() =>
      annotateDraftSchema.parse({
        id: "b3",
        path: "/x.md",
        originalText: "t",
        userAnnotation: "u",
        renderStart: -1,
        renderEnd: 3,
      }),
    );
    assert.throws(() =>
      annotateDraftSchema.parse({
        id: "b4",
        path: "/x.md",
        originalText: "t",
        userAnnotation: "u",
        renderStart: 1.5,
        renderEnd: 3,
      }),
    );
    assert.throws(() =>
      annotateDraftSchema.parse({
        id: "b5",
        path: "/x.md",
        originalText: "t",
        userAnnotation: "u",
        renderStart: 1,
      }),
    );
    assert.throws(() =>
      annotateDraftSchema.parse({
        id: "b6",
        path: "/x.md",
        originalText: "t",
        userAnnotation: "u",
        renderEnd: 4,
      }),
    );
  });

  it("XML build/parse round-trip 保留 renderStart/renderEnd；旧附件不挂", () => {
    const draft: AnnotateDraft = {
      id: "orig",
      path: "/round.md",
      originalText: "hello",
      userAnnotation: "请改",
      renderStart: 12,
      renderEnd: 17,
    };
    const att = buildFileAnnotateAttachmentFromDraft(draft);
    assert.match(att.content ?? "", /"renderStart": 12/);
    assert.match(att.content ?? "", /"renderEnd": 17/);

    const parsed = parseAnnotateDraftsFromAttachments([att]);
    assert.equal(parsed.length, 1);
    assert.notEqual(parsed[0]!.id, "orig");
    assert.equal(parsed[0]!.path, "/round.md");
    assert.equal(parsed[0]!.originalText, "hello");
    assert.equal(parsed[0]!.userAnnotation, "请改");
    assert.equal(parsed[0]!.renderStart, 12);
    assert.equal(parsed[0]!.renderEnd, 17);

    const legacyAtt: MessageAttachment = {
      name: "/legacy.md",
      source: "user_ops",
      type: "text",
      content:
        '<action name="annotate">\n{"path":"/legacy.md","originalText":"三字段","userAnnotation":"旧","startOffset":2,"endOffset":5}\n</action>',
      path: "/legacy.md",
      action: "annotate",
    };
    const legacyParsed = parseAnnotateDraftsFromAttachments([legacyAtt]);
    assert.equal(legacyParsed.length, 1);
    assert.equal(legacyParsed[0]!.renderStart, undefined);
    assert.equal(legacyParsed[0]!.renderEnd, undefined);
    assert.equal(legacyParsed[0]!.startOffset, 2);
    assert.equal(legacyParsed[0]!.endOffset, 5);
  });

  it("残缺/非法 render 对在 parse 时丢弃；public 已导出 schema", () => {
    const brokenAtt: MessageAttachment = {
      name: "/broken.md",
      source: "user_ops",
      type: "text",
      content:
        '<action name="annotate">\n{"path":"/broken.md","originalText":"x","userAnnotation":"y","renderStart":9}\n</action>',
      path: "/broken.md",
      action: "annotate",
    };
    const parsed = parseAnnotateDraftsFromAttachments([brokenAtt]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.renderStart, undefined);
    assert.equal(parsed[0]!.renderEnd, undefined);

    assert.equal(typeof publicChat.annotateDraftSchema.parse, "function");
    const viaPublic = publicChat.annotateDraftSchema.parse({
      id: "pub",
      path: "/p.md",
      originalText: "q",
      userAnnotation: "a",
      renderStart: 1,
      renderEnd: 3,
    });
    assert.equal(viaPublic.renderStart, 1);
    assert.equal(viaPublic.renderEnd, 3);
  });
});
