/**
 * Desktop 源锚预览合同（T-SA6 / T-SA8 / T-SA9）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ANNOTATE_ANCHOR_CLASS,
  ANNOTATE_SOFT_RANGE_CHAR_PADDING,
  ANNOTATE_SOFT_RANGE_LINE_PADDING,
  buildAnnotatedSource,
  estimateSoftOffsetRangeFromPlainOffsets,
  locateAnnotateOffsetRangeByQuoteContext,
} from "@shared/logic/chat";
import {
  collectAnnotateRangeForPreviewSelection,
  getSelectionOffsetsInElement,
  isPreviewAnnotateDomSearchFallbackEnabled,
  PREVIEW_ANNOTATE_ID_ATTR,
  resolveAnnotateIdsFromClick,
  setPreviewAnnotateDomSearchFallbackForTests,
} from "@/layout/preview-annotate";
import { sanitizeAnnotatePreviewHtml } from "@/layout/sanitize-annotate-preview-html";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const previewPanePath = path.join(
  __dirname,
  "..",
  "renderer",
  "layout",
  "PreviewPane.tsx",
);
const previewAnnotatePath = path.join(
  __dirname,
  "..",
  "renderer",
  "layout",
  "preview-annotate.ts",
);
const sanitizePath = path.join(
  __dirname,
  "..",
  "renderer",
  "layout",
  "sanitize-annotate-preview-html.ts",
);

function makeRoot(html: string): HTMLElement {
  const { document } = parseHTML(
    `<!DOCTYPE html><html><body><div id="root">${html}</div></body></html>`,
  );
  return document.getElementById("root") as HTMLElement;
}

afterEach(() => {
  setPreviewAnnotateDomSearchFallbackForTests(false);
});

describe("T-SA6 Desktop 认锚渲染 / 点击 / 消毒", () => {
  it("plain：消毒后仍保留 data-annotate-id；剥掉 script", () => {
    const raw =
      `<span class="${ANNOTATE_ANCHOR_CLASS}" data-annotate-id="d1">hello</span>` +
      `<script>alert(1)</script>`;
    const out = sanitizeAnnotatePreviewHtml(raw);
    assert.match(out, /data-annotate-id="d1"/);
    assert.match(out, new RegExp(`class="${ANNOTATE_ANCHOR_CLASS}"`));
    assert.match(out, /hello/);
    assert.doesNotMatch(out, /<script/i);
  });

  it("plain：注入后 DOM closest 可命中 id；用户不可见裸标签字符串", () => {
    const sourceText = "aaa hello bbb";
    const { annotatedSource } = buildAnnotatedSource({
      sourceText,
      drafts: [
        {
          id: "d1",
          path: "/a.txt",
          originalText: "hello",
          userAnnotation: "n",
          startOffset: 4,
          endOffset: 9,
        },
      ],
      mode: "text",
    });
    const sanitized = sanitizeAnnotatePreviewHtml(annotatedSource);
    assert.doesNotMatch(
      sanitized.replace(/<[^>]+>/g, ""),
      /nm-annotate-anchor|data-annotate-id/,
      "剥掉标签后正文不应残留裸锚字符串",
    );
    const root = makeRoot(`<pre class="preview-text">${sanitized}</pre>`);
    const anchor = root.querySelector(
      `[${PREVIEW_ANNOTATE_ID_ATTR}]`,
    ) as HTMLElement;
    assert.ok(anchor != null);
    assert.equal(anchor.getAttribute(PREVIEW_ANNOTATE_ID_ATTR), "d1");
    assert.equal(anchor.textContent, "hello");
    const ids = resolveAnnotateIdsFromClick(root, {
      clientX: 0,
      clientY: 0,
      target: anchor,
    });
    assert.deepEqual(ids, ["d1"]);
  });

  it("Desktop MD 已退役插锚：PreviewPane 不再含 buildAnnotatedSource / rehype-raw", () => {
    const pane = readFileSync(previewPanePath, "utf8");
    assert.doesNotMatch(pane, /buildAnnotatedSource/);
    assert.doesNotMatch(pane, /sanitizeAnnotatePreviewHtml/);
    assert.doesNotMatch(pane, /rehypeRaw|rehype-raw/);
    assert.match(pane, /createTextAnnotator/);
  });

  it("MD 派生串消毒后仍可 closest data-annotate-id（宿主 DOM 合同）", () => {
    const sourceText = "hel**lo**";
    const { annotatedSource, skippedDraftIds } = buildAnnotatedSource({
      sourceText,
      drafts: [
        {
          id: "md1",
          path: "/a.md",
          originalText: "hel**lo**",
          userAnnotation: "n",
          startOffset: 0,
          endOffset: sourceText.length,
        },
      ],
      mode: "markdown",
    });
    assert.deepEqual(skippedDraftIds, []);
    const sanitized = sanitizeAnnotatePreviewHtml(annotatedSource);
    assert.match(sanitized, /data-annotate-id="md1"/);
    // 模拟 rehype-raw 将锚 span 挂进 DOM（多壳同 id）
    const root = makeRoot(`<div class="preview-markdown">${sanitized}</div>`);
    const anchors = [
      ...root.querySelectorAll(`[${PREVIEW_ANNOTATE_ID_ATTR}="md1"]`),
    ];
    assert.ok(anchors.length >= 2, "Markdown 多壳同 id");
    const ids = resolveAnnotateIdsFromClick(root, {
      clientX: 0,
      clientY: 0,
      target: anchors[0]!,
    });
    assert.deepEqual(ids, ["md1"]);
  });
});

describe("T-SA8 Desktop plain 划词宽松 offset", () => {
  it("estimateSoftOffsetRangeFromPlainOffsets：CHAR→LINE 合并且覆盖选区", () => {
    const sourceText = "line1\nline2 hello here\nline3\nline4\nline5";
    const selStart = sourceText.indexOf("hello");
    const selEnd = selStart + "hello".length;
    const soft = estimateSoftOffsetRangeFromPlainOffsets(
      sourceText,
      selStart,
      selEnd,
    );
    assert.ok(soft.startOffset <= selStart);
    assert.ok(soft.endOffset >= selEnd);
    assert.ok(soft.endOffset - soft.startOffset > selEnd - selStart);
    assert.equal(ANNOTATE_SOFT_RANGE_CHAR_PADDING, 32);
    assert.equal(ANNOTATE_SOFT_RANGE_LINE_PADDING, 2);
  });

  it("plain：getSelectionOffsetsInElement → collect 写入权威 offset", () => {
    const sourceText = "prefix hello suffix";
    const helloAt = sourceText.indexOf("hello");
    const selEnd = helloAt + 5;

    // linkedom Range 残缺：用可驱动 getSelectionOffsetsInElement 的 stub
    const textNode = { nodeType: 3, nodeValue: sourceText };
    const pre = {
      contains(node: unknown) {
        return node === textNode;
      },
      ownerDocument: {
        createRange() {
          let endContainer: unknown = null;
          let endOffset = 0;
          return {
            selectNodeContents() {},
            setEnd(container: unknown, offset: number) {
              endContainer = container;
              endOffset = offset;
            },
            toString() {
              if (endContainer === textNode) {
                return sourceText.slice(0, endOffset);
              }
              return "";
            },
          };
        },
      },
    } as unknown as HTMLElement;

    const selRange = {
      startContainer: textNode,
      startOffset: helloAt,
      endContainer: textNode,
      endOffset: selEnd,
      toString: () => sourceText.slice(helloAt, selEnd),
    };
    const selection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => selRange,
    } as unknown as Selection;

    const measured = getSelectionOffsetsInElement(pre, selection);
    assert.deepEqual(measured, { start: helloAt, end: selEnd });

    const collected = collectAnnotateRangeForPreviewSelection({
      sourceText,
      isPlainPreview: true,
      selectedText: "hello",
      selection,
      plainRoot: pre,
    });
    assert.ok(collected.softOffsetRange != null);
    assert.ok(collected.softOffsetRange!.startOffset <= helloAt);
    assert.ok(collected.softOffsetRange!.endOffset >= selEnd);
    assert.ok(collected.softRange != null);
  });

  it("认锚 DOM 量测：Range.toString 不含标签字符（相对无锚源串）", () => {
    // 模拟已注入锚后 textContent 仍等于源串，选区 toString 长度不含标签
    const sourceText = "aahellobb";
    const helloAt = 2;
    const selEnd = 7;
    const textNode = { nodeType: 3, nodeValue: "hello" };
    const pre = {
      contains(node: unknown) {
        return node === textNode;
      },
      ownerDocument: {
        createRange() {
          let endOffset = 0;
          let mode: "before" | "other" = "other";
          return {
            selectNodeContents() {
              mode = "before";
            },
            setEnd(_c: unknown, offset: number) {
              endOffset = offset;
            },
            toString() {
              // 选区起点前的可见文本 = "aa" + hello 前缀
              if (mode === "before") {
                return sourceText.slice(0, helloAt + endOffset);
              }
              return "";
            },
          };
        },
      },
    } as unknown as HTMLElement;
    const selRange = {
      startContainer: textNode,
      startOffset: 0,
      endContainer: textNode,
      endOffset: 5,
      toString: () => "hello",
    };
    const selection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => selRange,
    } as unknown as Selection;
    const measured = getSelectionOffsetsInElement(pre, selection);
    assert.deepEqual(measured, { start: helloAt, end: selEnd });
    assert.equal(
      sourceText.slice(measured!.start, measured!.end),
      "hello",
    );
  });
});

describe("T-SA8b MD 邻域定位（Desktop → Core）", () => {
  it("唯一命中写入；多命中无邻域 → A12 null", () => {
    const source = "foo bar foo";
    assert.equal(
      locateAnnotateOffsetRangeByQuoteContext(source, {
        originalText: "foo",
      }),
      null,
    );
    assert.deepEqual(
      locateAnnotateOffsetRangeByQuoteContext(source, {
        originalText: "bar",
      }),
      { startOffset: 4, endOffset: 7 },
    );
  });

  it("多命中取邻域最近", () => {
    const source = "aaa foo bbb foo ccc";
    const hit = locateAnnotateOffsetRangeByQuoteContext(source, {
      originalText: "foo",
      contextBefore: "bbb ",
      contextAfter: " ccc",
    });
    assert.deepEqual(hit, { startOffset: 12, endOffset: 15 });
  });

  it("collectAnnotateRangeForPreviewSelection MD 路径走 Core 邻域定位", () => {
    const source = "aaa foo bbb foo ccc";
    const collected = collectAnnotateRangeForPreviewSelection({
      sourceText: source,
      isPlainPreview: false,
      selectedText: "foo",
      contextBefore: "bbb ",
      contextAfter: " ccc",
    });
    assert.ok(collected.softOffsetRange);
    assert.ok(
      collected.softOffsetRange!.startOffset <= 12 &&
        collected.softOffsetRange!.endOffset >= 15,
    );
    assert.equal(source.slice(12, 15), "foo");
  });
});

describe("T-SA9 Desktop 退役搜字主路径", () => {
  it("应急开关永久关", () => {
    assert.equal(isPreviewAnnotateDomSearchFallbackEnabled(), false);
    setPreviewAnnotateDomSearchFallbackForTests(true);
    assert.equal(isPreviewAnnotateDomSearchFallbackEnabled(), false);
  });

  it("PreviewPane 不接线 applyAnnotateHighlights / fallback", () => {
    const pane = readFileSync(previewPanePath, "utf8");
    assert.doesNotMatch(pane, /applyAnnotateHighlights/);
    assert.doesNotMatch(pane, /isPreviewAnnotateDomSearchFallbackEnabled/);
    assert.doesNotMatch(pane, /buildAnnotatedSource/);
  });

  it("preview-annotate 钉死 fallback 永久关闭", () => {
    const src = readFileSync(previewAnnotatePath, "utf8");
    assert.match(src, /永久关闭|始终 false|no-op/);
    assert.match(src, /isPreviewAnnotateDomSearchFallbackEnabled/);
  });
});
