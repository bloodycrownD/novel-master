/**
 * T-MD1~T-MD4：MermaidMarkdown 共享渲染组件（memo 缓存 / 未闭合 fence 占位 /
 * 唯一 id / 主题监听 / 源码保留隐藏）。mermaid 本体经 setMermaidSvgRendererForTests
 * 注入假渲染器，静态渲染不跑 effect（副作用只进 useEffect 的契约由源码断言钉死）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import {
  MermaidMarkdown,
  isMermaidKnownFailed,
  lookupMermaidSvg,
  nextMermaidId,
  resetMermaidCacheForTests,
  resolveMermaidTheme,
  resolveMermaidSvg,
  scanMermaidFences,
  setMermaidSvgRendererForTests,
} from "@/components/MermaidMarkdown";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const componentPath = path.join(
  __dirname,
  "..",
  "renderer",
  "components",
  "MermaidMarkdown.tsx",
);

const CLOSED_MERMAID = "```mermaid\nflowchart TD\nA-->B\n```";

test("T-MD2: scanMermaidFences 围栏配对检测", () => {
  assert.deepEqual(scanMermaidFences(CLOSED_MERMAID), {
    mermaidCount: 1,
    unclosedMermaid: false,
  });
  // 未闭合 mermaid：占位
  assert.deepEqual(scanMermaidFences("```mermaid\nflowchart TD\nA-->B"), {
    mermaidCount: 1,
    unclosedMermaid: true,
  });
  // 未闭合非 mermaid 围栏：不算占位
  assert.deepEqual(scanMermaidFences("```ts\nconst a = 1"), {
    mermaidCount: 0,
    unclosedMermaid: false,
  });
  // 前面闭合 mermaid + 文末未闭合 mermaid：只最后一个待定
  assert.deepEqual(
    scanMermaidFences(`${CLOSED_MERMAID}\n\n\`\`\`mermaid\nA-->B`),
    { mermaidCount: 2, unclosedMermaid: true },
  );
  // 同文档多个闭合块
  assert.deepEqual(scanMermaidFences(`${CLOSED_MERMAID}\n${CLOSED_MERMAID}`), {
    mermaidCount: 2,
    unclosedMermaid: false,
  });
});

test("T-MD2: resolveMermaidSvg 成功缓存——同源码重复渲染命中 memo 不重跑", async () => {
  resetMermaidCacheForTests();
  let calls = 0;
  setMermaidSvgRendererForTests(async () => {
    calls += 1;
    return "<svg>fake-ok</svg>";
  });
  try {
    const first = await resolveMermaidSvg(CLOSED_MERMAID, "default");
    assert.equal(first, "<svg>fake-ok</svg>");
    const second = await resolveMermaidSvg(CLOSED_MERMAID, "default");
    assert.equal(second, "<svg>fake-ok</svg>");
    assert.equal(calls, 1);
    // 主题不同 → 缓存 key 不同，须重跑
    await resolveMermaidSvg(CLOSED_MERMAID, "dark");
    assert.equal(calls, 2);
    assert.equal(lookupMermaidSvg("dark", CLOSED_MERMAID), "<svg>fake-ok</svg>");
  } finally {
    setMermaidSvgRendererForTests(null);
    resetMermaidCacheForTests();
  }
});

test("T-MD2: 语法错误 → 回退源码 + 失败标识（失败态可查，源码保留在 DOM）", async () => {
  resetMermaidCacheForTests();
  setMermaidSvgRendererForTests(async () => {
    throw new Error("parse error");
  });
  try {
    await assert.rejects(() => resolveMermaidSvg("not-a-diagram\n", "default"));
    assert.equal(isMermaidKnownFailed("default", "not-a-diagram\n"), true);
    assert.equal(lookupMermaidSvg("default", "not-a-diagram\n"), null);

    const html = renderToStaticMarkup(
      <MermaidMarkdown
        content={"正文\n\n```mermaid\nnot-a-diagram\n```"}
      />,
    );
    // 静态渲染即命中失败缓存：失败标识 + 源码可见容器，无图表容器
    assert.match(html, /mermaid-failed/);
    assert.match(html, /not-a-diagram/);
    assert.match(html, /mermaid-block__failed-badge/);
    assert.doesNotMatch(html, /mermaid-block__chart/);
  } finally {
    setMermaidSvgRendererForTests(null);
    resetMermaidCacheForTests();
  }
});

test("T-MD2: mermaid 源码 → 容器注入 SVG；源码隐藏保留（批注文本流）", async () => {
  resetMermaidCacheForTests();
  setMermaidSvgRendererForTests(async () => "<svg>fake-diagram</svg>");
  try {
    // 缓存 key 是 fence 内源码（remark 剥掉围栏、保留尾换行）
    await resolveMermaidSvg("flowchart TD\nA-->B\n", "default");
    const html = renderToStaticMarkup(
      <MermaidMarkdown content={`前文\n\n${CLOSED_MERMAID}\n\n后文`} />,
    );
    assert.match(html, /mermaid-block__chart/);
    assert.match(html, /fake-diagram/);
    // 源码保留在 .mermaid-block__source（display:none 由 CSS 控制，textContent 不丢）
    assert.match(html, /mermaid-block__source/);
    assert.match(html, /flowchart TD/);
    assert.doesNotMatch(html, /mermaid-block--pending/);
    assert.doesNotMatch(html, /mermaid-failed/);
  } finally {
    setMermaidSvgRendererForTests(null);
    resetMermaidCacheForTests();
  }
});

test("T-MD2: 未闭合 fence → 占位源码、不触发渲染、无失败标识", async () => {
  resetMermaidCacheForTests();
  let calls = 0;
  setMermaidSvgRendererForTests(async () => {
    calls += 1;
    return "<svg>should-not-appear</svg>";
  });
  try {
    const html = renderToStaticMarkup(
      <MermaidMarkdown content={`前文\n\n\`\`\`mermaid\nflowchart TD\nA-->B`} />,
    );
    assert.match(html, /mermaid-block--pending/);
    assert.match(html, /flowchart TD/);
    assert.doesNotMatch(html, /mermaid-block__chart/);
    assert.doesNotMatch(html, /mermaid-failed/);
    // 静态渲染不跑 effect；同文档中已闭合的 mermaid 块正常走缓存容器
    const mixed = renderToStaticMarkup(
      <MermaidMarkdown
        content={`${CLOSED_MERMAID}\n\n\`\`\`mermaid\nA-->B`}
      />,
    );
    assert.match(mixed, /mermaid-block--pending/);
    assert.equal(calls, 0);
  } finally {
    setMermaidSvgRendererForTests(null);
    resetMermaidCacheForTests();
  }
});

test("T-MD2: 每次 render 唯一 id", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 100; i++) {
    ids.add(nextMermaidId());
  }
  assert.equal(ids.size, 100);
});

test("T-MD3: 主题切换——data-theme 监听重渲染、清理 observer（源码契约）", () => {
  assert.equal(resolveMermaidTheme("dark"), "dark");
  assert.equal(resolveMermaidTheme("light"), "default");
  assert.equal(resolveMermaidTheme(null), "default");

  const src = readFileSync(componentPath, "utf8");
  // MutationObserver 监听 data-theme；卸载时 disconnect
  assert.match(src, /MutationObserver/);
  assert.match(src, /attributeFilter:\s*\["data-theme"\]/);
  assert.match(src, /observer\.disconnect\(\)/);
  assert.match(src, /documentElement/);
});

test("T-MD2/T-MD3: mermaid 副作用只进 useEffect（动态 import 不在 render 期）", () => {
  const src = readFileSync(componentPath, "utf8");
  assert.match(src, /import\("mermaid"\)/);
  // 动态 import 与 mermaid.render 位于 defaultRenderMermaidSvg（仅被 effect 链路调用）
  const fnStart = src.indexOf("async function defaultRenderMermaidSvg");
  assert.ok(fnStart > 0, "须存在 defaultRenderMermaidSvg");
  const fnEnd = src.indexOf("\n}", fnStart);
  const fnBody = src.slice(fnStart, fnEnd);
  assert.match(fnBody, /mermaid\.render/);
});
