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
  hasRecogitoRenderRange,
} from "@/layout/preview-recogito";
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
    const pane = readFileSync(previewPanePath, "utf8");
    assert.match(pane, /from "\.\/preview-recogito"/);
  });
});
