/**
 * 工具卡片「结果阅读」链路（T-TR 组）：
 * - toolResultViewFor 判定纯函数（集合 + 正文非空）
 * - ToolCallCard 渲染分支（可点 button + 提示文案 + aria-label）
 * - ToolResultViewOverlay 展示层（标题 + 正文 + 关闭）
 *
 * 监听壳（ToolResultViewerModal 的 useEffect）依赖 window 事件循环，
 * static render 不覆盖——其三行转发逻辑由 App 挂载与人工验收兜底。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolCallCard } from "@/features/chat/ToolCallCard";
import {
  ToolResultViewOverlay,
  toolResultViewFor,
} from "@/features/chat/ToolResultViewer";

function makeTool(overrides: Partial<Parameters<typeof toolResultViewFor>[0]>) {
  return {
    toolUseId: "tu-1",
    name: "search",
    input: { query: "x" },
    status: "success" as const,
    ...overrides,
  };
}

test("T-TR1: toolResultViewFor — 集合内工具 + 非空正文 → {title, content}", () => {
  assert.deepEqual(toolResultViewFor({ name: "search", resultContent: "结果正文" }), {
    title: "search",
    content: "结果正文",
  });
  assert.deepEqual(toolResultViewFor({ name: "grep", resultContent: "匹配行" }), {
    title: "grep",
    content: "匹配行",
  });
});

test("T-TR2: toolResultViewFor — 集合外工具（read/task）→ undefined（跳转优先，不进结果阅读）", () => {
  assert.equal(toolResultViewFor({ name: "read", resultContent: "正文" }), undefined);
  assert.equal(toolResultViewFor({ name: "task", resultContent: "正文" }), undefined);
  assert.equal(toolResultViewFor({ name: "fs", resultContent: "正文" }), undefined);
});

test("T-TR3: toolResultViewFor — 空串/纯空白/缺失正文 → undefined（无结果可读）", () => {
  assert.equal(toolResultViewFor({ name: "curl", resultContent: "" }), undefined);
  assert.equal(toolResultViewFor({ name: "curl", resultContent: "   " }), undefined);
  assert.equal(toolResultViewFor({ name: "curl" }), undefined);
});

test("T-TR4: ToolCallCard — search 带结果渲染可点 button + 「点击查看 · 结果」+ aria-label", () => {
  const html = renderToStaticMarkup(
    <ToolCallCard tool={makeTool({ resultContent: "结果正文" })} />,
  );
  assert.match(html, /<button/);
  assert.match(html, /点击查看 · 结果/);
  assert.match(html, /查看工具结果 search/);
});

test("T-TR5: ToolCallCard — search 无结果正文渲染不可点 div（无提示行）", () => {
  const html = renderToStaticMarkup(<ToolCallCard tool={makeTool({})} />);
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(html, /点击查看/);
});

test("T-TR6: ToolCallCard — glob 带结果同样可点（集合全员生效）", () => {
  const html = renderToStaticMarkup(
    <ToolCallCard tool={makeTool({ name: "glob", resultContent: "a.md\nb.md" })} />,
  );
  assert.match(html, /<button/);
  assert.match(html, /点击查看 · 结果/);
});

test("T-TR7: ToolResultViewOverlay — 渲染标题、正文与关闭按钮", () => {
  const html = renderToStaticMarkup(
    <ToolResultViewOverlay
      target={{ title: "search", content: "第 1 行结果\n第 2 行结果" }}
      onClose={() => undefined}
    />,
  );
  assert.match(html, /prompt-fullscreen__title[^>]*>search</);
  assert.match(html, /第 1 行结果/);
  assert.match(html, /第 2 行结果/);
  assert.match(html, /关闭/);
});
