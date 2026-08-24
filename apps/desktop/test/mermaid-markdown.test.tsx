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
  lookupMermaidFailedError,
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

test("T-MD2(C-1): svgCache LRU 上限——超限淘汰最旧、最新可命中、被淘汰后重跑", async () => {
  resetMermaidCacheForTests();
  // 与组件内 SVG_CACHE_MAX 保持一致
  const SVG_CACHE_MAX = 150;
  let calls = 0;
  setMermaidSvgRendererForTests(async (_id, source) => {
    calls += 1;
    return `<svg>${source.slice(0, 8)}</svg>`;
  });
  const first = "flowchart TD\nA-->B\n";
  const last = `graph LR\nn${SVG_CACHE_MAX - 1}-->m\n`;
  try {
    await resolveMermaidSvg(first, "default");
    // 再写入 SVG_CACHE_MAX 条不同源码，总数超上限一条 → 最早的 first 被淘汰
    for (let i = 0; i < SVG_CACHE_MAX; i += 1) {
      await resolveMermaidSvg(`graph LR\nn${i}-->m\n`, "default");
    }
    assert.equal(calls, SVG_CACHE_MAX + 1);
    // 最早条目被淘汰，最新条目仍可命中
    assert.equal(lookupMermaidSvg("default", first), null);
    assert.equal(
      lookupMermaidSvg("default", last),
      `<svg>${last.slice(0, 8)}</svg>`,
    );
    // 被淘汰后再次请求：重跑渲染（而非拿旧缓存）
    await resolveMermaidSvg(first, "default");
    assert.equal(calls, SVG_CACHE_MAX + 2);
  } finally {
    setMermaidSvgRendererForTests(null);
    resetMermaidCacheForTests();
  }
});

test("T-MD2(C-1): 失败占位 TTL——TTL 内视为已知失败，过期后清除并允许重试", async (t) => {
  resetMermaidCacheForTests();
  // 与组件内 FAILED_TTL_MS 保持一致
  const FAILED_TTL_MS = 30_000;
  t.mock.timers.enable({ now: 1_000 });
  let calls = 0;
  setMermaidSvgRendererForTests(async () => {
    calls += 1;
    throw new Error("transient render failure");
  });
  const source = "not-a-diagram\n";
  try {
    await assert.rejects(() => resolveMermaidSvg(source, "default"));
    assert.equal(isMermaidKnownFailed("default", source), true);
    // TTL 内：仍视为已知失败（不重试）
    t.mock.timers.tick(FAILED_TTL_MS - 1);
    assert.equal(isMermaidKnownFailed("default", source), true);
    // 过期：占位被清除，允许重试
    t.mock.timers.tick(1);
    assert.equal(isMermaidKnownFailed("default", source), false);
    await assert.rejects(() => resolveMermaidSvg(source, "default"));
    assert.equal(calls, 2);
  } finally {
    setMermaidSvgRendererForTests(null);
    resetMermaidCacheForTests();
  }
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

test("T-MD1: render 失败后静态渲染显示错误消息（badge/源码保留）", async () => {
  resetMermaidCacheForTests();
  setMermaidSvgRendererForTests(async () => {
    throw new Error("parse error on line 3");
  });
  try {
    // 先让 resolveMermaidSvg 落缓存（静态渲染不跑 effect，靠 useState 初始化查错误缓存）
    await assert.rejects(() => resolveMermaidSvg("not-a-diagram\n", "default"));
    assert.equal(
      lookupMermaidFailedError("default", "not-a-diagram\n"),
      "parse error on line 3",
    );

    const html = renderToStaticMarkup(
      <MermaidMarkdown
        content={"正文\n\n```mermaid\nnot-a-diagram\n```"}
      />,
    );
    // 错误消息文本出现在失败原因节点；badge 与源码保留，无图表容器
    assert.match(html, /mermaid-block__failed-reason/);
    assert.match(html, /parse error on line 3/);
    assert.match(html, /mermaid-block__failed-badge/);
    assert.match(html, /not-a-diagram/);
    assert.doesNotMatch(html, /mermaid-block__chart/);

    // 非 Error 形态（mermaid DetailedError 的 str 字段）也走统一提取口径
    setMermaidSvgRendererForTests(async () => {
      throw { str: "detailed-error-msg" };
    });
    await assert.rejects(() => resolveMermaidSvg("other-diagram\n", "default"));
    assert.equal(
      lookupMermaidFailedError("default", "other-diagram\n"),
      "detailed-error-msg",
    );
  } finally {
    setMermaidSvgRendererForTests(null);
    resetMermaidCacheForTests();
  }
});

test("T-MD2: 缓存命中重挂载仍显示错误原因；TTL 过期后错误缓存同步清除", async (t) => {
  resetMermaidCacheForTests();
  // 与组件内 FAILED_TTL_MS 保持一致
  const FAILED_TTL_MS = 30_000;
  t.mock.timers.enable({ now: 1_000 });
  let calls = 0;
  setMermaidSvgRendererForTests(async () => {
    calls += 1;
    throw new Error("boom-render");
  });
  const source = "not-a-diagram\n";
  try {
    await assert.rejects(() => resolveMermaidSvg(source, "default"));
    assert.equal(calls, 1);

    // 二次静态渲染（重挂载）：命中失败缓存不重跑 render，错误文本仍在
    for (let i = 0; i < 2; i += 1) {
      const html = renderToStaticMarkup(
        <MermaidMarkdown content={"```mermaid\nnot-a-diagram\n```"} />,
      );
      assert.match(html, /mermaid-block__failed-reason/);
      assert.match(html, /boom-render/);
    }
    assert.equal(calls, 1);

    // TTL 过期：失败占位与错误消息缓存一起被清除
    t.mock.timers.tick(FAILED_TTL_MS + 1);
    assert.equal(isMermaidKnownFailed("default", source), false);
    assert.equal(lookupMermaidFailedError("default", source), null);
  } finally {
    t.mock.timers.reset();
    setMermaidSvgRendererForTests(null);
    resetMermaidCacheForTests();
  }
});

test("T-MD3: 成功覆盖失败 / LRU 淘汰时错误缓存连带清除（防泄漏）", async () => {
  resetMermaidCacheForTests();
  // 与组件内 SVG_CACHE_MAX 保持一致
  const SVG_CACHE_MAX = 150;
  let failFlaky = true;
  setMermaidSvgRendererForTests(async (_id, source) => {
    if (source === "flaky\n" && failFlaky) {
      throw new Error("first-fail");
    }
    if (source === "victim\n") {
      throw new Error("victim-fail");
    }
    return "<svg>ok-now</svg>";
  });
  try {
    // 成功路径连带：失败后重试成功，错误缓存被清
    await assert.rejects(() => resolveMermaidSvg("flaky\n", "default"));
    assert.equal(lookupMermaidFailedError("default", "flaky\n"), "first-fail");
    failFlaky = false;
    await resolveMermaidSvg("flaky\n", "default");
    assert.equal(lookupMermaidSvg("default", "flaky\n"), "<svg>ok-now</svg>");
    assert.equal(lookupMermaidFailedError("default", "flaky\n"), null);

    // LRU 淘汰连带：失败占位被挤出 svgCache 时错误缓存同步删除
    await assert.rejects(() => resolveMermaidSvg("victim\n", "default"));
    assert.equal(lookupMermaidFailedError("default", "victim\n"), "victim-fail");
    for (let i = 0; i < SVG_CACHE_MAX; i += 1) {
      await resolveMermaidSvg(`graph LR\ne${i}-->m\n`, "default");
    }
    assert.equal(lookupMermaidFailedError("default", "victim\n"), null);
  } finally {
    setMermaidSvgRendererForTests(null);
    resetMermaidCacheForTests();
  }
});
