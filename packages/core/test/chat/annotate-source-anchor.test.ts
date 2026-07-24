/**
 * T-SA1–T-SA5：offset schema、XML 对称、buildAnnotatedSource text/markdown。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAnnotatedSource,
  escapeAnnotateSourceText,
} from "@/domain/chat/logic/annotate-source-anchor.js";
import {
  ANNOTATE_SOFT_RANGE_CHAR_PADDING,
  ANNOTATE_SOFT_RANGE_LINE_PADDING,
  deriveSoftRangeFieldsFromOffsets,
  estimateSoftOffsetRangeFromPlainOffsets,
} from "@/domain/chat/logic/annotate-source-range.js";
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

function draft(
  partial: Partial<AnnotateDraft> &
    Pick<AnnotateDraft, "id" | "originalText"> & {
      startOffset: number;
      endOffset: number;
    },
): AnnotateDraft {
  return {
    path: partial.path ?? "/t.md",
    userAnnotation: partial.userAnnotation ?? "注",
    ...partial,
  };
}

describe("T-SA1 annotateDraftSchema offset 半开语义", () => {
  it("接受合法半开 offset；缺省旧草稿仍合法", () => {
    const withOffset = annotateDraftSchema.parse({
      id: "a1",
      path: "/ch.md",
      originalText: "选区",
      userAnnotation: "注",
      startOffset: 0,
      endOffset: 4,
    });
    assert.equal(withOffset.startOffset, 0);
    assert.equal(withOffset.endOffset, 4);

    const legacy = annotateDraftSchema.parse({
      id: "a2",
      path: "/old.md",
      originalText: "旧",
      userAnnotation: "说明",
    });
    assert.equal(legacy.startOffset, undefined);
    assert.equal(legacy.endOffset, undefined);
  });

  it("拒绝 start≥end、非整数、负值、成对残缺", () => {
    assert.throws(() =>
      annotateDraftSchema.parse({
        id: "b1",
        path: "/x.md",
        originalText: "t",
        userAnnotation: "u",
        startOffset: 5,
        endOffset: 5,
      }),
    );
    assert.throws(() =>
      annotateDraftSchema.parse({
        id: "b2",
        path: "/x.md",
        originalText: "t",
        userAnnotation: "u",
        startOffset: 6,
        endOffset: 3,
      }),
    );
    assert.throws(() =>
      annotateDraftSchema.parse({
        id: "b3",
        path: "/x.md",
        originalText: "t",
        userAnnotation: "u",
        startOffset: -1,
        endOffset: 3,
      }),
    );
    assert.throws(() =>
      annotateDraftSchema.parse({
        id: "b4",
        path: "/x.md",
        originalText: "t",
        userAnnotation: "u",
        startOffset: 1.5,
        endOffset: 3,
      }),
    );
    assert.throws(() =>
      annotateDraftSchema.parse({
        id: "b5",
        path: "/x.md",
        originalText: "t",
        userAnnotation: "u",
        startOffset: 1,
      }),
    );
  });
});

describe("T-SA2 build/parse offset + 派生行列 + public 导出", () => {
  it("附件含 offset；派生行列 round-trip；旧附件无 offset 不挂", () => {
    const source = "L1\nhello world\nL3\n";
    const startOffset = source.indexOf("hello");
    const endOffset = startOffset + "hello".length;
    const lines = deriveSoftRangeFieldsFromOffsets(
      source,
      startOffset,
      endOffset,
    );
    const d: AnnotateDraft = {
      id: "orig",
      path: "/round.md",
      originalText: "hello",
      userAnnotation: "请改",
      startOffset,
      endOffset,
      ...lines,
    };
    const att = buildFileAnnotateAttachmentFromDraft(d);
    assert.match(att.content ?? "", /"startOffset":/);
    assert.match(att.content ?? "", /"endOffset":/);
    assert.match(att.content ?? "", /"startLine":/);
    assert.match(att.content ?? "", /"endLine":/);

    const parsed = parseAnnotateDraftsFromAttachments([att]);
    assert.equal(parsed.length, 1);
    assert.notEqual(parsed[0]!.id, "orig");
    assert.equal(parsed[0]!.startOffset, startOffset);
    assert.equal(parsed[0]!.endOffset, endOffset);
    assert.equal(parsed[0]!.startLine, lines.startLine);
    assert.equal(parsed[0]!.endLine, lines.endLine);
    assert.equal(parsed[0]!.startCol, lines.startCol);
    assert.equal(parsed[0]!.endCol, lines.endCol);

    const legacyAtt: MessageAttachment = {
      name: "/legacy.md",
      source: "user_ops",
      type: "text",
      content:
        '<action name="annotate">\n{"path":"/legacy.md","originalText":"三字段","userAnnotation":"旧"}\n</action>',
      path: "/legacy.md",
      action: "annotate",
    };
    const legacyParsed = parseAnnotateDraftsFromAttachments([legacyAtt]);
    assert.equal(legacyParsed.length, 1);
    assert.equal(legacyParsed[0]!.startOffset, undefined);
    assert.equal(legacyParsed[0]!.endOffset, undefined);
  });

  it("public/chat 导出本迭代新符号", () => {
    assert.equal(typeof publicChat.buildAnnotatedSource, "function");
    assert.equal(
      typeof publicChat.estimateSoftOffsetRangeFromPlainOffsets,
      "function",
    );
    assert.equal(publicChat.ANNOTATE_SOFT_RANGE_CHAR_PADDING, 32);
    assert.equal(publicChat.ANNOTATE_SOFT_RANGE_LINE_PADDING, 2);
  });

  it("estimateSoftOffsetRangeFromPlainOffsets：CHAR→LINE 合并且覆盖选区", () => {
    assert.equal(ANNOTATE_SOFT_RANGE_CHAR_PADDING, 32);
    assert.equal(ANNOTATE_SOFT_RANGE_LINE_PADDING, 2);
    const source = ["L1", "L2", "L3", "TARGET HERE", "L5", "L6", "L7"].join(
      "\n",
    );
    const selStart = source.indexOf("TARGET");
    const selEnd = selStart + "TARGET".length;
    const soft = estimateSoftOffsetRangeFromPlainOffsets(
      source,
      selStart,
      selEnd,
    );
    assert.ok(soft.startOffset <= selStart);
    assert.ok(soft.endOffset >= selEnd);
    assert.ok(soft.endOffset - soft.startOffset > selEnd - selStart);
    assert.ok(source.slice(soft.startOffset, soft.endOffset).includes("TARGET"));
  });
});

describe("T-SA3 buildAnnotatedSource 文本单壳 / 同文 / 重叠 skip", () => {
  it("范围内单壳；同文两处只亮范围内；重叠进 skippedDraftIds", () => {
    const source = "aaa foo bbb foo ccc";
    const first = source.indexOf("foo");
    const second = source.indexOf("foo", first + 1);
    const d1 = draft({
      id: "1",
      originalText: "foo",
      startOffset: first,
      endOffset: first + 3,
    });
    const dOverlap = draft({
      id: "2",
      originalText: "foo bbb foo",
      startOffset: first,
      endOffset: second + 3,
    });
    const dSecond = draft({
      id: "3",
      originalText: "foo",
      startOffset: second,
      endOffset: second + 3,
    });

    const { annotatedSource, skippedDraftIds } = buildAnnotatedSource({
      sourceText: source,
      drafts: [d1, dOverlap, dSecond],
      mode: "text",
    });

    assert.deepEqual(skippedDraftIds, ["2"]);
    const open1 = annotatedSource.match(
      /data-annotate-id="1"/g,
    );
    const open3 = annotatedSource.match(
      /data-annotate-id="3"/g,
    );
    assert.equal(open1?.length, 1);
    assert.equal(open3?.length, 1);
    assert.ok(
      annotatedSource.includes(
        `<span class="nm-annotate-anchor" data-annotate-id="1">foo</span>`,
      ),
    );
    assert.ok(
      annotatedSource.includes(
        `<span class="nm-annotate-anchor" data-annotate-id="3">foo</span>`,
      ),
    );
    // 中间 bbb 不在壳内误包成单壳跨两处
    assert.match(annotatedSource, /foo<\/span> bbb <span/);
  });

  it("A13 校验失败则 skip；源中 < 被转义", () => {
    const source = "a <b> c";
    const bad = draft({
      id: "bad",
      originalText: "完全不对",
      startOffset: 0,
      endOffset: source.length,
    });
    const good = draft({
      id: "good",
      originalText: "<b>",
      startOffset: 2,
      endOffset: 5,
    });
    const { annotatedSource, skippedDraftIds } = buildAnnotatedSource({
      sourceText: source,
      drafts: [bad, good],
      mode: "text",
    });
    assert.deepEqual(skippedDraftIds, ["bad"]);
    assert.ok(annotatedSource.includes("&lt;b&gt;"));
    assert.equal(escapeAnnotateSourceText("<x>"), "&lt;x&gt;");
  });
});

describe("T-SA4 buildAnnotatedSource markdown 多壳同 id", () => {
  it("hel**lo** 切开为多段同 id，而非单壳跨 **", () => {
    const source = "hel**lo**";
    const dOk = draft({
      id: "1",
      originalText: "hel**lo**",
      startOffset: 0,
      endOffset: source.length,
    });
    const { annotatedSource, skippedDraftIds } = buildAnnotatedSource({
      sourceText: source,
      drafts: [dOk],
      mode: "markdown",
    });
    assert.deepEqual(skippedDraftIds, []);
    const opens = annotatedSource.match(/data-annotate-id="1"/g);
    assert.ok(opens != null && opens.length >= 2);
    // 定界符在壳外；多壳同 id
    assert.match(
      annotatedSource,
      /data-annotate-id="1">hel<\/span>\*\*<span class="nm-annotate-anchor" data-annotate-id="1">lo<\/span>\*\*/,
    );
  });
});

describe("T-SA5 围栏代码内不注入锚", () => {
  it("选区落入围栏代码：skipped；草稿仍由调用方持有", () => {
    const source = "before\n```\ncode here\n```\nafter";
    const codeStart = source.indexOf("code here");
    const d = draft({
      id: "code-1",
      originalText: "code here",
      startOffset: codeStart,
      endOffset: codeStart + "code here".length,
      userAnnotation: "仍在草稿",
    });
    const { annotatedSource, skippedDraftIds } = buildAnnotatedSource({
      sourceText: source,
      drafts: [d],
      mode: "markdown",
    });
    assert.deepEqual(skippedDraftIds, ["code-1"]);
    assert.equal(annotatedSource.includes("nm-annotate-anchor"), false);
    assert.equal(annotatedSource.includes("data-annotate-id"), false);
    // 源仍完整（转义后无尖括号变化）
    assert.ok(annotatedSource.includes("code here"));
    // 调用方草稿对象未被本函数删除
    assert.equal(d.id, "code-1");
    assert.equal(d.userAnnotation, "仍在草稿");
  });
});
