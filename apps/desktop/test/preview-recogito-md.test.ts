/**
 * T-RG2 / T-RG6：Desktop Recogito MD 预览合同（无插锚 / plain 禁用）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  isPreviewAnnotateDomSearchFallbackEnabled,
  isPreviewAnnotateEnabled,
  setPreviewAnnotateDomSearchFallbackForTests,
} from "@/layout/preview-annotate";
import {
  draftToRecogitoAnnotation,
  draftsToRecogitoAnnotations,
  extractRecogitoRenderRange,
  getSelectionOffsetsInElement,
  hasRecogitoRenderRange,
} from "@/layout/preview-recogito";
import {
  getSelectionOffsetsInElement as getLegacySelectionOffsetsInElement,
} from "@/layout/preview-annotate";
import type { AnnotateDraft } from "@shared/logic/chat";

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
const previewRecogitoPath = path.join(
  __dirname,
  "..",
  "renderer",
  "layout",
  "preview-recogito.ts",
);
const previewAnnotateUiPath = path.join(
  __dirname,
  "..",
  "renderer",
  "layout",
  "PreviewAnnotateUi.tsx",
);
const packageJsonPath = path.join(__dirname, "..", "package.json");

describe("T-RG2 Desktop 退役插锚 / 搜字主路径", () => {
  it("PreviewPane 不调用 buildAnnotatedSource；干净 react-markdown", () => {
    const pane = readFileSync(previewPanePath, "utf8");
    assert.doesNotMatch(pane, /buildAnnotatedSource/);
    assert.doesNotMatch(pane, /sanitizeAnnotatePreviewHtml/);
    assert.doesNotMatch(pane, /rehypeRaw|rehype-raw/);
    assert.doesNotMatch(pane, /applyAnnotateHighlights/);
    assert.doesNotMatch(pane, /isPreviewAnnotateDomSearchFallbackEnabled/);
    assert.doesNotMatch(pane, /domSearchFallback/);
    assert.doesNotMatch(pane, /setPreviewAnnotateDomSearchFallbackForTests/);
    assert.match(pane, /react-markdown|from "react-markdown"/);
    assert.match(pane, /<Markdown remarkPlugins=\{\[remarkGfm\]\}>\{content\}<\/Markdown>/);
  });

  it("DOM 搜字 fallback 开关永久关闭（调用无效）", () => {
    assert.equal(isPreviewAnnotateDomSearchFallbackEnabled(), false);
    setPreviewAnnotateDomSearchFallbackForTests(true);
    assert.equal(isPreviewAnnotateDomSearchFallbackEnabled(), false);
    setPreviewAnnotateDomSearchFallbackForTests(false);
    const src = readFileSync(previewAnnotatePath, "utf8");
    assert.match(src, /永久关闭|始终 false|no-op/);
  });
});

describe("T-RG6 Desktop MD Recogito；plain 禁用批注", () => {
  it("package 依赖 @recogito/text-annotator", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    assert.ok(pkg.dependencies?.["@recogito/text-annotator"]);
  });

  it("PreviewPane 源码：createTextAnnotator + setAnnotations；仅 MD 根", () => {
    const pane = readFileSync(previewPanePath, "utf8");
    assert.match(pane, /createTextAnnotator/);
    assert.match(pane, /@recogito\/text-annotator/);
    assert.match(pane, /setAnnotations/);
    assert.match(pane, /draftsToRecogitoAnnotations|extractRecogitoRenderRange/);
    assert.match(pane, /mdRootRef|preview-markdown/);
    assert.match(pane, /isPreviewAnnotateEnabled\([\s\S]*isMarkdown/);
    // plain 仅 pre.preview-text，不挂 Recogito
    assert.match(pane, /preview-text/);
    assert.doesNotMatch(
      pane,
      /createTextAnnotator\([^)]*preview-text/,
    );
  });

  it("R6：annotatingEnabled false；mouseup 不直开 Add；显式 FloatingBar；cancelSelected/destroy", () => {
    const pane = readFileSync(previewPanePath, "utf8");
    assert.match(pane, /annotatingEnabled:\s*false/);
    assert.match(pane, /PreviewAnnotateFloatingBar/);
    assert.match(pane, /cancelSelected/);
    assert.match(pane, /\.destroy\(\)/);
    // mouseup 只更新 pending / floating，禁止 setAddOpen(true)
    const mouseUpBody = pane.match(
      /const onMouseUp = \(\) => \{[\s\S]*?\n    \};/,
    );
    assert.ok(mouseUpBody, "须存在 onMouseUp");
    assert.doesNotMatch(mouseUpBody![0], /setAddOpen\(true\)/);
    // 显式入口：FloatingBar onAdd 才开 AddModal
    assert.match(
      pane,
      /PreviewAnnotateFloatingBar[\s\S]*?onAdd=\{[\s\S]*?setAddOpen\(true\)/,
    );
    // 命中已有 draft 时关 Add
    assert.match(pane, /setAddOpen\(false\)/);
  });

  it("门闩：MD 才启用；plain 禁用", () => {
    assert.equal(isPreviewAnnotateEnabled("read", "chat", "s1", true), true);
    assert.equal(isPreviewAnnotateEnabled("read", "chat", "s1", false), false);
    assert.equal(isPreviewAnnotateEnabled("read", "chat", "s1"), false);
  });

  it("AddModal 写入 renderStart/renderEnd；不再写 soft offset 权威", () => {
    const ui = readFileSync(previewAnnotateUiPath, "utf8");
    assert.match(ui, /renderStart/);
    assert.match(ui, /renderEnd/);
    assert.match(ui, /addChatAnnotateDraft/);
    assert.doesNotMatch(ui, /softOffsetRange/);
    assert.doesNotMatch(ui, /startOffset:/);
  });

  it("映射：draft ↔ Recogito quote/start/end 一致", () => {
    const draft: AnnotateDraft = {
      id: "d1",
      path: "/a.md",
      originalText: "hello",
      userAnnotation: "note",
      renderStart: 4,
      renderEnd: 9,
    };
    assert.equal(hasRecogitoRenderRange(draft), true);
    const ann = draftToRecogitoAnnotation(draft);
    assert.ok(ann != null);
    assert.equal(ann!.id, "d1");
    const range = extractRecogitoRenderRange(ann!);
    assert.deepEqual(range, {
      quote: "hello",
      renderStart: 4,
      renderEnd: 9,
    });
    const legacy: AnnotateDraft = {
      id: "old",
      path: "/a.md",
      originalText: "hello",
      userAnnotation: "n",
      startOffset: 0,
      endOffset: 5,
    };
    assert.equal(hasRecogitoRenderRange(legacy), false);
    assert.equal(draftToRecogitoAnnotation(legacy), null);
    assert.deepEqual(draftsToRecogitoAnnotations([draft, legacy]).map((a) => a.id), [
      "d1",
    ]);
  });

  it("preview-recogito 模块存在且被 PreviewPane 引用", () => {
    const mapSrc = readFileSync(previewRecogitoPath, "utf8");
    assert.match(mapSrc, /draftToRecogitoAnnotation/);
    assert.match(mapSrc, /extractRecogitoRenderRange/);
    assert.match(mapSrc, /getSelectionOffsetsInElement/);
    const pane = readFileSync(previewPanePath, "utf8");
    assert.match(pane, /from "\.\/preview-recogito"/);
    // 权威实现仅在 preview-recogito；annotate 侧委托
    const annotateSrc = readFileSync(previewAnnotatePath, "utf8");
    assert.match(
      annotateSrc,
      /getSelectionOffsetsInElement as getRecogitoSelectionOffsetsInElement/,
    );
  });

  it("getSelectionOffsetsInElement：首尾空白 trim 后 slice 对齐 quote（策略 b）", () => {
    const bodyText = "prefix  hello  suffix";
    const selStart = bodyText.indexOf("  hello  ");
    const selEnd = selStart + "  hello  ".length;
    const textNode = { nodeType: 3, nodeValue: bodyText };
    const el = {
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
                return bodyText.slice(0, endOffset);
              }
              return "";
            },
          };
        },
      },
    } as unknown as Element;
    const selRange = {
      startContainer: textNode,
      startOffset: selStart,
      endContainer: textNode,
      endOffset: selEnd,
      toString: () => bodyText.slice(selStart, selEnd),
    };
    const selection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => selRange,
    } as unknown as Selection;

    const range = getSelectionOffsetsInElement(el, selection);
    assert.ok(range != null);
    assert.equal(range!.quote, "hello");
    assert.equal(
      bodyText.slice(range!.renderStart, range!.renderEnd),
      range!.quote,
    );

    // annotate 委托路径与权威一致
    const legacy = getLegacySelectionOffsetsInElement(
      el as HTMLElement,
      selection,
    );
    assert.deepEqual(legacy, {
      start: range!.renderStart,
      end: range!.renderEnd,
    });
  });
});
