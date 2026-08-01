/**
 * stripRenderCoords：Undo 恢复历史批注时丢弃 Recogito 渲染坐标，
 * 使 FM 并入 doc-body 后错位的历史坐标落入既有降级路径（不投影高亮，chip/详情/发送仍可用）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseAnnotateDraftsFromAttachments,
  stripRenderCoords,
} from "@/domain/chat/logic/build-attachment-action-xml.js";
import { annotateDraftSchema } from "@/domain/chat/model/annotate-draft.schema.js";
import * as publicChat from "@novel-master/core/chat";

describe("stripRenderCoords", () => {
  it("丢弃 renderStart/renderEnd，保留其余字段，且不修改原对象", () => {
    const drafts = [
      {
        id: "d1",
        path: "/a.md",
        originalText: "选区文本",
        userAnnotation: "批注说明",
        renderStart: 10,
        renderEnd: 20,
        startOffset: 5,
        endOffset: 9,
        startLine: 2,
        endLine: 2,
        startCol: 1,
        endCol: 5,
      },
    ];
    const stripped = stripRenderCoords(drafts);

    assert.equal(stripped.length, 1);
    const s = stripped[0]!;
    assert.equal(s.renderStart, undefined);
    assert.equal(s.renderEnd, undefined);
    // 其余字段保留
    assert.equal(s.id, "d1");
    assert.equal(s.path, "/a.md");
    assert.equal(s.originalText, "选区文本");
    assert.equal(s.userAnnotation, "批注说明");
    assert.equal(s.startOffset, 5);
    assert.equal(s.endOffset, 9);
    assert.equal(s.startLine, 2);
    assert.equal(s.endLine, 2);
    assert.equal(s.startCol, 1);
    assert.equal(s.endCol, 5);
    // 返回新对象，不修改原数组元素
    assert.notEqual(stripped[0], drafts[0]);
    assert.equal(drafts[0].renderStart, 10);
    assert.equal(drafts[0].renderEnd, 20);
  });

  it("strip 后对象能通过 annotateDraftSchema（render 缺省合法）", () => {
    const drafts = [
      {
        id: "d2",
        path: "/b.md",
        originalText: "x",
        userAnnotation: "y",
        renderStart: 0,
        renderEnd: 1,
        startOffset: 3,
        endOffset: 4,
      },
    ];
    const stripped = stripRenderCoords(drafts);
    const parsed = annotateDraftSchema.parse(stripped[0]);
    assert.equal(parsed.renderStart, undefined);
    assert.equal(parsed.renderEnd, undefined);
    assert.equal(parsed.startOffset, 3);
    assert.equal(parsed.endOffset, 4);
  });

  it("空数组 / 无 render 坐标的草稿原样保留", () => {
    assert.deepEqual(stripRenderCoords([]), []);
    const noRender = [
      {
        id: "d3",
        path: "/c.md",
        originalText: "q",
        userAnnotation: "无坐标",
        startOffset: 1,
        endOffset: 2,
      },
    ];
    const stripped = stripRenderCoords(noRender);
    assert.equal(stripped[0]!.renderStart, undefined);
    assert.equal(stripped[0]!.renderEnd, undefined);
    assert.equal(stripped[0]!.startOffset, 1);
  });

  it("public 已导出 stripRenderCoords 与 parse 链路对称（历史附件 → strip）", () => {
    const att = {
      name: "/round-strip.md",
      source: "user_ops",
      type: "text",
      content:
        '<action name="annotate">\n{"path":"/round-strip.md","originalText":"hello","userAnnotation":"请改","renderStart":12,"renderEnd":17,"startOffset":2,"endOffset":7}\n</action>',
      path: "/round-strip.md",
      action: "annotate" as const,
    };
    const parsed = parseAnnotateDraftsFromAttachments([att]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.renderStart, 12);

    const stripped = publicChat.stripRenderCoords(parsed);
    assert.equal(stripped[0]!.renderStart, undefined);
    assert.equal(stripped[0]!.renderEnd, undefined);
    assert.equal(stripped[0]!.originalText, "hello");
    assert.equal(stripped[0]!.userAnnotation, "请改");
    assert.equal(stripped[0]!.startOffset, 2);
    assert.equal(stripped[0]!.endOffset, 7);
  });
});
