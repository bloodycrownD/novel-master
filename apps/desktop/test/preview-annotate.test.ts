/**
 * Desktop PreviewPane 划词批注纯逻辑测例（门闩 / 聚合 / 选区文本 / 跨节点 mark）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyAnnotateHighlights,
  clearAnnotateHighlights,
  groupAnnotateIdsByOriginalText,
  isPreviewAnnotateEnabled,
  parseAnnotateIdsAttr,
  PREVIEW_ANNOTATE_IDS_ATTR,
  PREVIEW_ANNOTATE_MARK_CLASS,
  readSelectionTextInContainer,
} from "@/layout/preview-annotate";

/** linkedom：与 Mobile 同合同的等价 DOM 宿主。 */
function makeRoot(html: string): HTMLElement {
  const { document } = parseHTML(
    `<!DOCTYPE html><html><body><div id="root">${html}</div></body></html>`,
  );
  return document.getElementById("root") as HTMLElement;
}

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
    assert.match(src, /buildFlatTextIndex/);
    assert.match(src, /mapFlatRangeToSegments/);
    assert.doesNotMatch(src, /@novel-master\/core/);
    assert.doesNotMatch(src, /findFirstUnmarkedPlainMatch/);
    assert.doesNotMatch(src, /跨元素连续串无法匹配时跳过/);
  });
});

describe("applyAnnotateHighlights DOM（T-XN3 / T-XN4 / T-XN5 / T-XN6）", () => {
  it("T-XN3: 跨 strong 两段 preview-annotate-mark", () => {
    const root = makeRoot("<p>hel<strong>lo</strong></p>");
    applyAnnotateHighlights(root, [{ id: "d1", originalText: "hello" }]);
    const marks = [
      ...root.querySelectorAll(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`),
    ];
    assert.equal(marks.length, 2);
    assert.equal(marks.map((m) => m.textContent).join(""), "hello");
  });

  it("T-XN4: 多段 mark 的 data-annotate-ids 一致", () => {
    const root = makeRoot("<p>hel<a>lo</a></p>");
    applyAnnotateHighlights(root, [
      { id: "a", originalText: "hello" },
      { id: "b", originalText: "hello" },
    ]);
    const marks = [
      ...root.querySelectorAll(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`),
    ];
    assert.ok(marks.length >= 2);
    const attrs = marks.map((m) => m.getAttribute(PREVIEW_ANNOTATE_IDS_ATTR));
    assert.equal(new Set(attrs).size, 1);
    assert.deepEqual(parseAnnotateIdsAttr(attrs[0]), ["a", "b"]);
  });

  it("T-XN5: 原文不在文档 → 无 mark", () => {
    const root = makeRoot("<p>hel<strong>lo</strong></p>");
    applyAnnotateHighlights(root, [{ id: "x", originalText: "missing" }]);
    assert.equal(
      root.querySelectorAll(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`).length,
      0,
    );
  });

  it("T-XN6: 同文两处均标；长串优先", () => {
    const root = makeRoot("<p>hello hello</p>");
    applyAnnotateHighlights(root, [
      { id: "long", originalText: "hello hello" },
      { id: "short", originalText: "hello" },
    ]);
    const marks = [
      ...root.querySelectorAll(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`),
    ];
    assert.equal(marks.length, 1);
    assert.equal(marks[0]?.textContent, "hello hello");

    const root2 = makeRoot("<p>hello hello</p>");
    applyAnnotateHighlights(root2, [{ id: "s", originalText: "hello" }]);
    assert.equal(
      root2.querySelectorAll(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`).length,
      2,
    );
  });

  it("B-1: 先长后短，跨已有 mark 的短针不得误命中", () => {
    // 文档「h」+「ell」+「o」；长针先包 ell 后，短针「ho」不得跨 mark 拼域命中
    const root = makeRoot("<p>hello</p>");
    applyAnnotateHighlights(root, [
      { id: "long", originalText: "ell" },
      { id: "short", originalText: "ho" },
    ]);
    const marks = [
      ...root.querySelectorAll(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`),
    ];
    assert.equal(marks.length, 1);
    assert.equal(marks[0]?.textContent, "ell");
    assert.deepEqual(
      parseAnnotateIdsAttr(marks[0]?.getAttribute(PREVIEW_ANNOTATE_IDS_ATTR)),
      ["long"],
    );
    assert.equal(root.textContent, "hello");
  });

  it("跨 p 不误命中；clear 后再 apply 无残留", () => {
    const root = makeRoot("<p>hel</p><p>lo</p>");
    applyAnnotateHighlights(root, [{ id: "x", originalText: "hello" }]);
    assert.equal(
      root.querySelectorAll(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`).length,
      0,
    );

    const root2 = makeRoot("<p>hel<strong>lo</strong></p>");
    applyAnnotateHighlights(root2, [{ id: "d1", originalText: "hello" }]);
    assert.equal(
      root2.querySelectorAll(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`).length,
      2,
    );
    clearAnnotateHighlights(root2);
    assert.equal(
      root2.querySelectorAll(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`).length,
      0,
    );
    applyAnnotateHighlights(root2, [{ id: "d1", originalText: "hello" }]);
    assert.equal(
      root2.querySelectorAll(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`).length,
      2,
    );
  });
});

describe("applyAnnotateHighlights 表格连续域（T-AT3 / T-AT4 / T-AT5 / T-AT6 / T-AT7）", () => {
  it("T-AT3: 跨格选区（含 tab）→ ≥2 段 mark 并集覆盖 aabb", () => {
    const root = makeRoot(`<table>
  <tr>
    <td>aa</td>
    <td>bb</td>
  </tr>
</table>`);
    applyAnnotateHighlights(root, [{ id: "t3", originalText: "aa\tbb" }]);
    const marks = [
      ...root.querySelectorAll(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`),
    ];
    assert.ok(marks.length >= 2);
    assert.equal(marks.map((m) => m.textContent).join(""), "aabb");
  });

  it("T-AT4: 整行多格高亮覆盖可见文本", () => {
    const root = makeRoot(
      "<table><tr><td>aa</td><td>bb</td><td>cc</td></tr></table>",
    );
    applyAnnotateHighlights(root, [
      { id: "t4", originalText: "aa\tbb\tcc" },
    ]);
    const marks = [
      ...root.querySelectorAll(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`),
    ];
    assert.ok(marks.length >= 3);
    assert.equal(marks.map((m) => m.textContent).join(""), "aabbcc");
  });

  it("T-AT5: 表尾+段首拼接串零 mark", () => {
    const root = makeRoot(
      "<table><tr><td>zz</td></tr></table><p>xx</p>",
    );
    applyAnnotateHighlights(root, [{ id: "t5", originalText: "zzxx" }]);
    assert.equal(
      root.querySelectorAll(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`).length,
      0,
    );
  });

  it("T-AT6: 同格 hel<strong>lo</strong> 仍 ≥2 段 mark", () => {
    const root = makeRoot(
      "<table><tr><td>hel<strong>lo</strong></td></tr></table>",
    );
    applyAnnotateHighlights(root, [{ id: "t6", originalText: "hello" }]);
    const marks = [
      ...root.querySelectorAll(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`),
    ];
    assert.ok(marks.length >= 2);
    assert.equal(marks.map((m) => m.textContent).join(""), "hello");
  });

  it("T-AT7: 跨 p 的 lohe 仍零命中", () => {
    const root = makeRoot("<p>hello</p><p>hello</p>");
    applyAnnotateHighlights(root, [{ id: "t7", originalText: "lohe" }]);
    assert.equal(
      root.querySelectorAll(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`).length,
      0,
    );
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
    assert.match(pane, /target\.closest\(`mark\.\$\{PREVIEW_ANNOTATE_MARK_CLASS\}`\)/);
    assert.match(pane, /parseAnnotateIdsAttr/);
    assert.doesNotMatch(pane, /e\.preventDefault\(\);\s*\n\s*scheduleRefresh/);
  });
});
