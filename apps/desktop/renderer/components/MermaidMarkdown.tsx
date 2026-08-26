import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { PluggableList } from "unified";
import { renderCodeBlock } from "./code-block";

/**
 * 共享 Markdown 渲染组件：react-markdown + remarkGfm + mermaid 图表。
 *
 * - mermaid 代码块在 useEffect 内动态 import('mermaid') 渲染 SVG（render 期间零副作用，
 *   静态渲染测试不跑 effect）；成功后源码 <pre> 以 display:none 保留在 DOM，
 *   保证批注 renderStart/End 的文本流不被破坏。
 * - 按「主题 + 源码」memo 缓存：流式每帧全量重渲时源码不变不重跑 mermaid.render。
 *   svgCache 为 LRU（上限 SVG_CACHE_MAX，超出淘汰最旧），失败占位带 TTL
 *   （FAILED_TTL_MS 内视为已知失败，过期后允许重试），防长会话内存只增不减、
 *   临时性渲染失败（如并发初始化冲突）变永久失败。
 * - 未闭合 fence（流式进行中）的最后一个 mermaid 块按占位样式显示源码，
 *   不触发渲染、不挂失败标识；remark 解析会丢失「是否闭合」信息，
 *   因此围栏配对检测在组件层对原始 content 做，再经块序号传给渲染器。
 * - 每次 mermaid.render 使用自增唯一 id，避免并发渲染 / 主题重渲共用 id 冲突。
 * - 主题：读 html[data-theme]（ThemeProvider 写入），MutationObserver 监听切换重渲染。
 */

export type MermaidTheme = "dark" | "default";

/** 围栏扫描结果：mermaid 围栏总数 + 文末是否存在未闭合 mermaid 围栏。 */
export interface MermaidFenceScan {
  mermaidCount: number;
  unclosedMermaid: boolean;
}

/**
 * 逐行配对围栏（```/~~~ 至少三连，CommonMark 简化版：闭合须同字符且不短于开栏）。
 * 仅用于流式占位判定，与 remark 的解析偶有边界差异时最多影响占位块的选择，无崩溃风险。
 */
export function scanMermaidFences(content: string): MermaidFenceScan {
  let openChar = "";
  let openLen = 0;
  let openInfo = "";
  let mermaidCount = 0;
  let unclosedMermaid = false;
  const lines = content.split("\n");
  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!m) {
      continue;
    }
    const fence = m[1]!;
    const info = m[2]!.trim();
    if (openChar === "") {
      openChar = fence[0]!;
      openLen = fence.length;
      openInfo = info;
      continue;
    }
    if (fence[0] === openChar && fence.length >= openLen && info === "") {
      if (openInfo.split(/\s+/)[0] === "mermaid") {
        mermaidCount += 1;
      }
      openChar = "";
      openLen = 0;
      openInfo = "";
    }
  }
  if (openChar !== "" && openInfo.split(/\s+/)[0] === "mermaid") {
    mermaidCount += 1;
    unclosedMermaid = true;
  }
  return { mermaidCount, unclosedMermaid };
}

/** 主题属性 → mermaid 主题（导出供单测）。 */
export function resolveMermaidTheme(dataTheme: string | null): MermaidTheme {
  return dataTheme === "dark" ? "dark" : "default";
}

function readDataTheme(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  return document.documentElement.getAttribute("data-theme");
}

let mermaidIdCounter = 0;

/** 每次渲染唯一 id（自增），避免共用固定 id 报错。 */
export function nextMermaidId(): string {
  mermaidIdCounter += 1;
  return `nm-mermaid-${mermaidIdCounter}`;
}

export function mermaidCacheKey(theme: MermaidTheme, source: string): string {
  return `${theme}\u0000${source}`;
}

/**
 * 统一错误消息提取口径（与 mobile 端 mermaid-core 一致）：
 * Error 取 message；mermaid 的 DetailedError 非Error形态取 str 字段，其余 String() 兑底。
 */
function extractMermaidErrorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : String((err as { str?: string }).str ?? err);
}

/** svgCache 的 LRU 上限：超出淘汰最旧（spec desktop/C-1，建议 100~200 取中）。 */
const SVG_CACHE_MAX = 150;
/** 失败占位 TTL：过期后视为未失败，下次渲染重走一次 mermaid.render。 */
const FAILED_TTL_MS = 30_000;

/** 源码 → SVG 的结果缓存（含失败占位），跨组件实例复用；Map 迭代序即 LRU 新旧序。 */
const svgCache = new Map<string, string>();
/** 失败占位的写入时间（与 svgCache 的 key 同步维护）。 */
const failedAtCache = new Map<string, number>();
/** 失败错误消息缓存（key 与 svgCache 一致；LRU 淘汰 / TTL 过期 / 成功覆盖 / reset 四处连带清理）。 */
const failedErrorCache = new Map<string, string>();
const FAILED_PLACEHOLDER = "\u0000__failed__";
const inflight = new Map<string, Promise<string>>();

/** LRU 命中即提升为最新（Map 尾部）。 */
function touchCacheKey(key: string): void {
  const value = svgCache.get(key);
  if (value !== undefined) {
    svgCache.delete(key);
    svgCache.set(key, value);
  }
}

/** LRU 写入：覆盖或新增后若超上限，从 Map 头部淘汰最旧（连带失败时间戳）。 */
function writeCacheKey(key: string, value: string): void {
  svgCache.delete(key);
  svgCache.set(key, value);
  while (svgCache.size > SVG_CACHE_MAX) {
    const oldest = svgCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    svgCache.delete(oldest);
    failedAtCache.delete(oldest);
    failedErrorCache.delete(oldest);
  }
}

export function lookupMermaidSvg(
  theme: MermaidTheme,
  source: string,
): string | null {
  const key = mermaidCacheKey(theme, source);
  const cached = svgCache.get(key);
  if (cached == null || cached === FAILED_PLACEHOLDER) {
    return null;
  }
  touchCacheKey(key);
  return cached;
}

export function isMermaidKnownFailed(
  theme: MermaidTheme,
  source: string,
): boolean {
  const key = mermaidCacheKey(theme, source);
  if (svgCache.get(key) !== FAILED_PLACEHOLDER) {
    return false;
  }
  const failedAt = failedAtCache.get(key) ?? 0;
  if (Date.now() - failedAt >= FAILED_TTL_MS) {
    // 失败占位过期：清掉占位，允许下次渲染重试。
    svgCache.delete(key);
    failedAtCache.delete(key);
    failedErrorCache.delete(key);
    return false;
  }
  touchCacheKey(key);
  return true;
}

/** 查询已缓存的失败错误消息（静态渲染不跑 effect，失败态文案靠这条兜底）。 */
export function lookupMermaidFailedError(
  theme: MermaidTheme,
  source: string,
): string | null {
  return failedErrorCache.get(mermaidCacheKey(theme, source)) ?? null;
}

/** 可注入的渲染实现（默认动态 import mermaid；测试替换以断言调用次数）。 */
export type MermaidSvgRenderer = (
  id: string,
  source: string,
  theme: MermaidTheme,
) => Promise<string>;

async function defaultRenderMermaidSvg(
  id: string,
  source: string,
  theme: MermaidTheme,
): Promise<string> {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({ startOnLoad: false, theme, securityLevel: "strict" });
  try {
    const { svg } = await mermaid.render(id, source);
    return svg;
  } catch (err) {
    // mermaid 失败时可能往 body 残留 d<id> 错误元素，清掉避免污染布局
    if (typeof document !== "undefined") {
      document.getElementById(`d${id}`)?.remove();
    }
    throw err;
  }
}

let renderMermaidSvgImpl: MermaidSvgRenderer = defaultRenderMermaidSvg;

export function setMermaidSvgRendererForTests(fn: MermaidSvgRenderer | null) {
  renderMermaidSvgImpl = fn ?? defaultRenderMermaidSvg;
}

/** 缓存感知的渲染入口：命中缓存 / 合并并发同源请求，失败写入失败占位。 */
export async function resolveMermaidSvg(
  source: string,
  theme: MermaidTheme,
): Promise<string> {
  const key = mermaidCacheKey(theme, source);
  const cached = svgCache.get(key);
  if (cached != null && cached !== FAILED_PLACEHOLDER) {
    touchCacheKey(key);
    return cached;
  }
  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }
  const job = renderMermaidSvgImpl(nextMermaidId(), source, theme)
    .then((svg) => {
      writeCacheKey(key, svg);
      failedAtCache.delete(key);
      failedErrorCache.delete(key);
      return svg;
    })
    .catch((err) => {
      writeCacheKey(key, FAILED_PLACEHOLDER);
      failedAtCache.set(key, Date.now());
      failedErrorCache.set(key, extractMermaidErrorMessage(err));
      throw err;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, job);
  return job;
}

/** 测试隔离：清空 memo 缓存、失败标记、失败时间戳与失败错误消息。 */
export function resetMermaidCacheForTests(): void {
  svgCache.clear();
  failedAtCache.clear();
  failedErrorCache.clear();
  inflight.clear();
}

/** 读取并监听 html[data-theme]；无 DOM 环境（静态渲染）安全降级。 */
function useMermaidTheme(): MermaidTheme {
  const [theme, setTheme] = useState<MermaidTheme>(() =>
    resolveMermaidTheme(readDataTheme()),
  );
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    setTheme(resolveMermaidTheme(readDataTheme()));
    const observer = new MutationObserver(() => {
      setTheme(resolveMermaidTheme(readDataTheme()));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      observer.disconnect();
    };
  }, []);
  return theme;
}

interface MermaidBlockProps {
  source: string;
  pending: boolean;
  theme: MermaidTheme;
}

const MermaidBlock = memo(function MermaidBlock({
  source,
  pending,
  theme,
}: MermaidBlockProps) {
  const [svg, setSvg] = useState<string | null>(() =>
    pending ? null : lookupMermaidSvg(theme, source),
  );
  const [failed, setFailed] = useState(() =>
    pending ? false : isMermaidKnownFailed(theme, source),
  );
  // 错误文案双通道：静态渲染（renderToStaticMarkup 不跑 effect）靠初始化查缓存；
  // 挂载后置 effect 路径靠 catch 时 setState。
  const [failedError, setFailedError] = useState<string | null>(() =>
    pending ? null : lookupMermaidFailedError(theme, source),
  );

  useEffect(() => {
    if (pending) {
      return;
    }
    const cached = lookupMermaidSvg(theme, source);
    if (cached != null) {
      setSvg(cached);
      setFailed(false);
      setFailedError(null);
      return;
    }
    if (isMermaidKnownFailed(theme, source)) {
      setSvg(null);
      setFailed(true);
      setFailedError(lookupMermaidFailedError(theme, source));
      return;
    }
    let cancelled = false;
    resolveMermaidSvg(source, theme)
      .then((rendered) => {
        if (!cancelled) {
          setSvg(rendered);
          setFailed(false);
          setFailedError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSvg(null);
          setFailed(true);
          setFailedError(extractMermaidErrorMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [source, theme, pending]);

  const cls = [
    "mermaid-block",
    failed ? "mermaid-failed" : "",
    pending ? "mermaid-block--pending" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      {failed ? (
        <>
          <span className="mermaid-block__failed-badge">图表渲染失败，已显示源码</span>
          {failedError ? (
            <pre className="mermaid-block__failed-reason">{failedError}</pre>
          ) : null}
        </>
      ) : null}
      {svg ? (
        <div
          className="mermaid-block__chart"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : null}
      {/* 源码始终保留在 DOM：成功态 display:none 隐藏（批注文本流不偏移），失败/占位态可见 */}
      <pre className="mermaid-block__source">
        <code>{source}</code>
      </pre>
    </div>
  );
});

function extractChildCode(children: ReactNode): {
  className: string | undefined;
  source: string;
} {
  const child = Array.isArray(children) ? children[0] : children;
  if (child == null || typeof child !== "object" || !("props" in child)) {
    return { className: undefined, source: "" };
  }
  const props = (child as { props?: { className?: unknown; children?: unknown } })
    .props;
  const className =
    typeof props?.className === "string" ? props.className : undefined;
  const raw = props?.children;
  const source = Array.isArray(raw) ? raw.join("") : String(raw ?? "");
  return { className, source };
}

export interface MermaidMarkdownProps {
  content: string;
}

/**
 * 高亮语言注册表（与 mobile highlight-code.ts 的 core 注册同源；任一端增删须双端同步）。
 * html 由 xml 模块内置别名承载；shell 不在 bash 模块内置 aliases（仅 sh/zsh），须显式注册。
 */
const HIGHLIGHT_LANGUAGES = {
  typescript,
  javascript,
  json,
  python,
  bash,
  sql,
  markdown,
  yaml,
  xml,
  css,
};

const rehypePlugins: PluggableList = [
  [
    rehypeHighlight,
    {
      // 显式注册即整体替换缺省 common 集（37 语言），注册表外的 rust 等不会被高亮
      languages: HIGHLIGHT_LANGUAGES,
      aliases: { bash: ["shell"] },
      // mermaid code 连 hljs 空类也不加：命中在加类之前 return，extractChildCode 仍取纯文本
      plainText: ["mermaid"],
      detect: false,
    },
  ],
];

export function MermaidMarkdown({ content }: MermaidMarkdownProps) {
  const theme = useMermaidTheme();
  const scan = useMemo(() => scanMermaidFences(content), [content]);
  // 本轮渲染已遇到的 mermaid 块序号：流式未闭合时只让最后一个块走占位
  const mermaidIndexRef = useRef(0);
  mermaidIndexRef.current = 0;

  const components = useMemo<Components>(
    () => ({
      pre({ children }) {
        const { className, source } = extractChildCode(children);
        // mermaid 特判放宽为 includes：className 含多个类时严格相等会失配（双保险兜底）
        if (className?.includes("language-mermaid")) {
          const index = mermaidIndexRef.current;
          mermaidIndexRef.current += 1;
          const pending =
            scan.unclosedMermaid && index === scan.mermaidCount - 1;
          return <MermaidBlock source={source} pending={pending} theme={theme} />;
        }
        return renderCodeBlock(children);
      },
    }),
    [theme, scan],
  );

  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {content}
    </Markdown>
  );
}
