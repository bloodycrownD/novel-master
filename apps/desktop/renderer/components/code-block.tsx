import {
  cloneElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * 围栏语言归一化表（PRD 清单）：别名 → 规范名。
 * 与 mobile 端 highlight-code.ts 的 LANG_ALIAS 保持同一张表，
 * 任一端增删语言须双端同步（T-CB13 一致性契约）。
 */
const FENCE_LANG_ALIAS: Record<string, string> = {
  typescript: "typescript",
  ts: "typescript",
  tsx: "typescript",
  javascript: "javascript",
  js: "javascript",
  jsx: "javascript",
  python: "python",
  py: "python",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  sql: "sql",
  markdown: "markdown",
  yaml: "yaml",
  yml: "yaml",
  html: "html",
  css: "css",
  json: "json",
};

/**
 * fence 原始语言名 → 规范名（语言标签显示值）。
 * 不在清单（如 rust）或无语言返回 null：纯文本块级形态、无 data-lang。
 */
export function normalizeFenceLang(
  lang: string | null | undefined,
): string | null {
  if (!lang) {
    return null;
  }
  return FENCE_LANG_ALIAS[lang.toLowerCase()] ?? null;
}

/** 从高亮后的 React 子树收集纯文本（hljs span 不改文本，拼接即源码）。 */
function collectNodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => collectNodeText(child)).join("");
  }
  if (typeof node === "object" && "props" in node) {
    return collectNodeText(
      (node as { props?: { children?: ReactNode } }).props?.children,
    );
  }
  return "";
}

/**
 * 代码块复制按钮：SVG 图标零文本节点（批注文本流零偏移，同语言标签伪元素策略）；
 * 复制成功后图标切换对勾 1.5s。
 */
function CodeCopyButton({ source }: { source: string }) {
  const [copied, setCopied] = useState(false);
  // 复位定时器句柄：卸载时清理，避免对已卸载组件 setState（MF-10）
  const resetTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (resetTimerRef.current != null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);
  return (
    <button
      type="button"
      className={`code-copy-btn${copied ? " code-copy-btn--copied" : ""}`}
      aria-label="复制代码"
      onClick={() => {
        void navigator.clipboard.writeText(source).then(() => {
          setCopied(true);
          resetTimerRef.current = window.setTimeout(
            () => setCopied(false),
            1500,
          );
        }).catch((err: unknown) => {
          // 复制失败（如剪贴板权限被拒）静默降级，仅留 debug 日志（MF-10）
          console.debug("code-copy: clipboard write failed", err);
        });
      }}
    >
      {copied ? (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M3 8.5 6.5 12 13 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M11 3.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6.5A1.5 1.5 0 0 0 3 11h.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      )}
    </button>
  );
}

/** 从 code 的 className 提取 language-xxx 的原始语言名。 */
function extractLangFromClass(className: string | undefined): string | null {
  if (!className) {
    return null;
  }
  const m = /(?:^|\s)language-([^\s]+)/.exec(className);
  return m?.[1] ?? null;
}

/**
 * rehype-highlight 处理后的 pre children（code 元素）→ 块级代码渲染：
 * - 清单内语言：`<pre data-lang={规范名}>`（标签走 CSS 伪元素，不进文本流，批注零偏移）；
 * - 无语言 / 清单外语言：裸 `<pre>`，并剥掉插件静默跳过后残留的空 `hljs` 类
 *   （避免降级块被 `.hljs` 类选择器误命中，样式隔离不干净）。
 */
export function renderCodeBlock(children: ReactNode): ReactNode {
  const child = Array.isArray(children) ? children[0] : children;
  const source =
    child != null && typeof child === "object" && "props" in child
      ? collectNodeText(
          (child as { props?: { children?: ReactNode } }).props?.children,
        )
      : "";
  const copyBtn = <CodeCopyButton source={source} />;
  if (child == null || typeof child !== "object" || !("props" in child)) {
    return (
      <pre>
        {copyBtn}
        {children}
      </pre>
    );
  }
  const props = (child as { props?: { className?: unknown } }).props;
  const className =
    typeof props?.className === "string" ? props.className : undefined;
  const normalized = normalizeFenceLang(extractLangFromClass(className));
  if (normalized) {
    return (
      <pre data-lang={normalized}>
        {copyBtn}
        {children}
      </pre>
    );
  }
  if (className && /(?:^|\s)hljs(?:\s|$)/.test(className)) {
    const stripped =
      className
        .split(/\s+/)
        .filter((cls) => cls && cls !== "hljs")
        .join(" ") || undefined;
    return (
      <pre>
        {copyBtn}
        {cloneElement(child as ReactElement, { className: stripped })}
      </pre>
    );
  }
  return (
    <pre>
      {copyBtn}
      {children}
    </pre>
  );
}
