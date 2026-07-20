/**
 * Desktop PreviewPane 划词批注纯逻辑测例（门闩 / 聚合 / 选区文本）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  groupAnnotateIdsByOriginalText,
  isPreviewAnnotateEnabled,
  parseAnnotateIdsAttr,
  readSelectionTextInContainer,
} from "@/layout/preview-annotate";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const previewPanePath = path.join(
  __dirname,
  "..",
  "renderer",
  "layout",
  "PreviewPane.tsx",
);
const previewAnnotateUiPath = path.join(
  __dirname,
  "..",
  "renderer",
  "layout",
  "PreviewAnnotateUi.tsx",
);

describe("isPreviewAnnotateEnabled", () => {
  it("仅 read + chat + 非空 sessionId 为真", () => {
    assert.equal(isPreviewAnnotateEnabled("read", "chat", "s1"), true);
  });

  it("编辑态无入口", () => {
    assert.equal(isPreviewAnnotateEnabled("edit", "chat", "s1"), false);
  });

  it("global / session 无入口", () => {
    assert.equal(isPreviewAnnotateEnabled("read", "global", "s1"), false);
    assert.equal(isPreviewAnnotateEnabled("read", "session", "s1"), false);
  });

  it("缺 scope 无入口", () => {
    assert.equal(isPreviewAnnotateEnabled("read", null, "s1"), false);
    assert.equal(isPreviewAnnotateEnabled("read", undefined, "s1"), false);
  });

  it("缺 sessionId / 空串无入口", () => {
    assert.equal(isPreviewAnnotateEnabled("read", "chat"), false);
    assert.equal(isPreviewAnnotateEnabled("read", "chat", null), false);
    assert.equal(isPreviewAnnotateEnabled("read", "chat", undefined), false);
    assert.equal(isPreviewAnnotateEnabled("read", "chat", ""), false);
  });
});

describe("groupAnnotateIdsByOriginalText", () => {
  it("同文聚合多 id；空原文与空 id 跳过", () => {
    const map = groupAnnotateIdsByOriginalText([
      { id: "a", originalText: "hello" },
      { id: "b", originalText: "hello" },
      { id: "c", originalText: "other" },
      { id: "d", originalText: "" },
      { id: "", originalText: "skip" },
    ]);
    assert.deepEqual(map.get("hello"), ["a", "b"]);
    assert.deepEqual(map.get("other"), ["c"]);
    assert.equal(map.has(""), false);
    assert.equal(map.has("skip"), false);
  });
});

describe("parseAnnotateIdsAttr", () => {
  it("解析逗号分隔 id", () => {
    assert.deepEqual(parseAnnotateIdsAttr("a,b , c"), ["a", "b", "c"]);
    assert.deepEqual(parseAnnotateIdsAttr(""), []);
    assert.deepEqual(parseAnnotateIdsAttr(null), []);
  });
});

describe("readSelectionTextInContainer", () => {
  it("无 selection / collapsed → null", () => {
    assert.equal(readSelectionTextInContainer(null, null), null);
    const collapsed = {
      rangeCount: 1,
      isCollapsed: true,
      anchorNode: {},
      focusNode: {},
      toString: () => "x",
    } as unknown as Selection;
    assert.equal(readSelectionTextInContainer({} as ParentNode, collapsed), null);
  });

  it("选区节点须在 container 内", () => {
    const inside = { name: "inside" };
    const outside = { name: "outside" };
    const container = {
      contains(node: unknown) {
        return node === inside;
      },
    } as unknown as ParentNode;
    const bad = {
      rangeCount: 1,
      isCollapsed: false,
      anchorNode: inside,
      focusNode: outside,
      toString: () => "hello",
    } as unknown as Selection;
    assert.equal(readSelectionTextInContainer(container, bad), null);

    const ok = {
      rangeCount: 1,
      isCollapsed: false,
      anchorNode: inside,
      focusNode: inside,
      toString: () => "  hello  ",
    } as unknown as Selection;
    assert.equal(readSelectionTextInContainer(container, ok), "hello");
  });
});

describe("applyAnnotateHighlights order (source)", () => {
  it("按 originalText 长度降序再 wrap（经 @shared/logic 调 core sort）", () => {
    const src = readFileSync(
      path.join(__dirname, "..", "renderer", "layout", "preview-annotate.ts"),
      "utf8",
    );
    assert.match(src, /sortAnnotateTextsLongestFirst/);
    assert.match(src, /@shared\/logic\/chat/);
    assert.doesNotMatch(src, /@novel-master\/core/);
  });
});

describe("Preview annotate UI wiring (source)", () => {
  it("弹层组件接线 store CRUD 与「添加批注」文案", () => {
    const ui = readFileSync(previewAnnotateUiPath, "utf8");
    assert.match(ui, /addChatAnnotateDraft/);
    assert.match(ui, /添加批注/);
    assert.match(ui, /updateChatAnnotateDraft/);
    assert.match(ui, /removeChatAnnotateDraft/);
    assert.match(ui, /text-prompt-modal__textarea/);
    assert.doesNotMatch(ui, /TextPromptModal/);
  });

  it("PreviewPane 门闩与浮动条接入", () => {
    const pane = readFileSync(previewPanePath, "utf8");
    assert.match(pane, /isPreviewAnnotateEnabled/);
    assert.match(pane, /PreviewAnnotateFloatingBar/);
    assert.match(pane, /previewFile\?\.workspaceScope/);
    assert.match(pane, /applyAnnotateHighlights/);
    assert.match(pane, /sessionId/);
    assert.doesNotMatch(pane, /e\.preventDefault\(\);\s*\n\s*scheduleRefresh/);
  });
});
