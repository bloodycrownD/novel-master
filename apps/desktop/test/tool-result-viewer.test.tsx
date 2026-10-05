/**
 * 工具卡片「结果阅读」链路（T-TR 组）：
 * - toolResultViewFor 判定纯函数（通用兜底：正文非空即产载荷，无工具集合）
 * - ToolCallCard 渲染分支（专属跳转优先，兜底阅读可点 + 提示文案 + aria-label）
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

test("T-TR1: toolResultViewFor — 任意工具 + 非空正文 → {title, content}（通用兜底，无集合）", () => {
  assert.deepEqual(toolResultViewFor({ name: "search", resultContent: "结果正文" }), {
    title: "search",
    content: "结果正文",
  });
  assert.deepEqual(toolResultViewFor({ name: "fs", resultContent: "entries…" }), {
    title: "fs",
    content: "entries…",
  });
  assert.deepEqual(toolResultViewFor({ name: "agent", resultContent: "list 输出" }), {
    title: "agent",
    content: "list 输出",
  });
});

test("T-TR2: toolResultViewFor — 专属跳转工具也产阅读载荷（read/task 不除外）", () => {
  // 兜底载荷对 read/task 同样产出；专属跳转优先由 ToolCallCard 的
  // 优先级链保证（见 T-TR8），本函数不做集合拦截。
  assert.deepEqual(toolResultViewFor({ name: "read", resultContent: "正文" }), {
    title: "read",
    content: "正文",
  });
  assert.deepEqual(toolResultViewFor({ name: "task", resultContent: "子会话摘要" }), {
    title: "task",
    content: "子会话摘要",
  });
});

test("T-TR3: toolResultViewFor — 空串/纯空白/缺失正文 → undefined（无结果可读）", () => {
  assert.equal(toolResultViewFor({ name: "curl", resultContent: "" }), undefined);
  assert.equal(toolResultViewFor({ name: "curl", resultContent: "   " }), undefined);
  assert.equal(toolResultViewFor({ name: "curl" }), undefined);
});

test("T-TR3b: toolResultViewFor — content 空串但 summary 有信息 → 用 summary（fs 空目录/glob 0 paths 真机实锤）", () => {
  assert.deepEqual(
    toolResultViewFor({ name: "fs", resultContent: "", summary: "0 entries" }),
    { title: "fs", content: "0 entries" },
  );
  assert.deepEqual(
    toolResultViewFor({ name: "glob", summary: "0 paths" }),
    { title: "glob", content: "0 paths" },
  );
  // 两者皆空 → 不可点
  assert.equal(
    toolResultViewFor({ name: "fs", resultContent: "", summary: "" }),
    undefined,
  );
});

test("T-TR4: ToolCallCard — search 带结果渲染可点 button + 「点击查看 · 结果」+ aria-label", () => {
  const html = renderToStaticMarkup(
    <ToolCallCard tool={makeTool({ resultContent: "结果正文" })} />,
  );
  assert.match(html, /<button/);
  assert.match(html, /点击查看 · 结果/);
  assert.match(html, /查看工具结果 search/);
});

test("T-TR5: ToolCallCard — 无结果正文渲染不可点 div（无提示行）", () => {
  const html = renderToStaticMarkup(<ToolCallCard tool={makeTool({})} />);
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(html, /点击查看/);
});

test("T-TR6: ToolCallCard — glob 带结果同样可点（兜底全员生效）", () => {
  const html = renderToStaticMarkup(
    <ToolCallCard tool={makeTool({ name: "glob", resultContent: "a.md\nb.md" })} />,
  );
  assert.match(html, /<button/);
  assert.match(html, /点击查看 · 结果/);
});

test("T-TR6b: ToolCallCard — fs 带结果可点（无专属跳转的典型兜底对象）", () => {
  const html = renderToStaticMarkup(
    <ToolCallCard
      tool={makeTool({ name: "fs", input: { action: "ls", path: "/foo" }, resultContent: "目录列表" })}
    />,
  );
  assert.match(html, /<button/);
  assert.match(html, /点击查看 · 结果/);
});

test("T-TR8: ToolCallCard — read 带结果且挂了 onOpenFile 时仍优先跳文件（专属跳转优先于兜底）", () => {
  const html = renderToStaticMarkup(
    <ToolCallCard
      tool={makeTool({
        name: "read",
        input: { path: "/notes/a.md" },
        resultContent: "文件正文…",
      })}
      onOpenFile={() => undefined}
    />,
  );
  assert.match(html, /<button/);
  // aria-label 是「打开文件」而非「查看工具结果」——优先级链未被兜底顶掉
  assert.match(html, /打开文件 \/notes\/a\.md/);
  assert.doesNotMatch(html, /查看工具结果/);
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

test("T-TR9: toolResultViewFor — 带 input → 载荷带 inputJson（原文 pretty JSON）", () => {
  const detail = toolResultViewFor({
    name: "curl",
    input: { url: "https://example.com", method: "POST" },
    resultContent: "HTTP 200",
  });
  assert.deepEqual(detail, {
    title: "curl",
    content: "HTTP 200",
    inputJson: JSON.stringify(
      { url: "https://example.com", method: "POST" },
      null,
      2,
    ),
  });
});

test("T-TR9b: toolResultViewFor — 无 input → 不带 inputJson 字段", () => {
  assert.deepEqual(toolResultViewFor({ name: "search", resultContent: "结果" }), {
    title: "search",
    content: "结果",
  });
  // ToolCallView.input 是必有字段，但入参在真实载荷里仍可能缺失（老消息 /
  // 流式未拼齐）：这时载荷退回纯结果形态，Modal 也只渲染结果区块。
  assert.deepEqual(
    toolResultViewFor({ name: "search", input: undefined, resultContent: "结果" }),
    { title: "search", content: "结果" },
  );
});

test("T-TR9c: toolResultViewFor — input stringify 抛（循环引用）→ 只退结果，不崩", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.deepEqual(
    toolResultViewFor({ name: "custom", input: cyclic, resultContent: "结果" }),
    { title: "custom", content: "结果" },
  );
});

test("T-TR10: ToolResultViewOverlay — 带 inputJson → 「入参」+「结果」两段（入参在前）", () => {
  const html = renderToStaticMarkup(
    <ToolResultViewOverlay
      target={{
        title: "curl",
        content: "HTTP 200 OK",
        inputJson: '{\n  "url": "https://example.com"\n}',
      }}
      onClose={() => undefined}
    />,
  );
  assert.match(html, /prompt-fullscreen__label[^>]*>入参</);
  assert.match(html, /prompt-fullscreen__label[^>]*>结果</);
  assert.match(html, /&quot;url&quot;: &quot;https:\/\/example\.com&quot;/);
  assert.match(html, /HTTP 200 OK/);
  // 入参区块必须排在结果之前（阅读顺序：先看发了什么，再看回了什么）。
  // 锚到 label 类名上比较位置：Modal 根上还有 `curl结果` 这类 aria-label，
  // 直接找「结果」二字会命中它，顺序断言就废了。
  const inputAt = html.search(/prompt-fullscreen__label[^>]*>入参</);
  const resultAt = html.search(/prompt-fullscreen__label[^>]*>结果</);
  assert.ok(inputAt < resultAt, `入参 label @${inputAt}，结果 label @${resultAt}`);
});

test("T-TR10b: ToolResultViewOverlay — 无 inputJson → 只渲染结果区块，无「入参」标签", () => {
  const html = renderToStaticMarkup(
    <ToolResultViewOverlay
      target={{ title: "search", content: "结果正文" }}
      onClose={() => undefined}
    />,
  );
  assert.doesNotMatch(html, /入参/);
  assert.doesNotMatch(html, /prompt-fullscreen__label/);
  assert.match(html, /结果正文/);
});
