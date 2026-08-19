import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

/**
 * 共享 Markdown 渲染组件：react-markdown + remarkGfm + mermaid 图表。
 *
 * - mermaid 代码块在 useEffect 内动态 import('mermaid') 渲染 SVG（render 期间零副作用，
 *   静态渲染测试不跑 effect）；成功后源码 <pre> 以 display:none 保留在 DOM，
 *   保证批注 renderStart/End 的文本流不被破坏。
 * - 按「主题 + 源码」memo 缓存：流式每帧全量重渲时源码不变不重跑 mermaid.render。
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

/** 源码 → SVG 的结果缓存（含失败占位），跨组件实例复用。 */
const svgCache = new Map<string, string>();
const FAILED_PLACEHOLDER = "\u0000__failed__";
const inflight = new Map<string, Promise<string>>();

export function lookupMermaidSvg(
  theme: MermaidTheme,
  source: string,
): string | null {
  const cached = svgCache.get(mermaidCacheKey(theme, source));
  if (cached == null || cached === FAILED_PLACEHOLDER) {
    return null;
  }
  return cached;
}

export function isMermaidKnownFailed(
  theme: MermaidTheme,
  source: string,
): boolean {
  return svgCache.get(mermaidCacheKey(theme, source)) === FAILED_PLACEHOLDER;
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
    return cached;
  }
  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }
  const job = renderMermaidSvgImpl(nextMermaidId(), source, theme)
    .then((svg) => {
      svgCache.set(key, svg);
      return svg;
    })
    .catch((err) => {
      svgCache.set(key, FAILED_PLACEHOLDER);
      throw err;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, job);
  return job;
}

/** 测试隔离：清空 memo 缓存与失败标记。 */
export function resetMermaidCacheForTests(): void {
  svgCache.clear();
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

  useEffect(() => {
    if (pending) {
      return;
    }
    const cached = lookupMermaidSvg(theme, source);
    if (cached != null) {
      setSvg(cached);
      setFailed(false);
      return;
    }
    if (isMermaidKnownFailed(theme, source)) {
      setSvg(null);
      setFailed(true);
      return;
    }
    let cancelled = false;
    resolveMermaidSvg(source, theme)
      .then((rendered) => {
        if (!cancelled) {
          setSvg(rendered);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSvg(null);
          setFailed(true);
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
        <span className="mermaid-block__failed-badge">图表渲染失败，已显示源码</span>
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
        if (className === "language-mermaid") {
          const index = mermaidIndexRef.current;
          mermaidIndexRef.current += 1;
          const pending =
            scan.unclosedMermaid && index === scan.mermaidCount - 1;
          return <MermaidBlock source={source} pending={pending} theme={theme} />;
        }
        return <pre>{children}</pre>;
      },
    }),
    [theme, scan],
  );

  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </Markdown>
  );
}
