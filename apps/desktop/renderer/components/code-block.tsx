import { cloneElement, type ReactElement, type ReactNode } from "react";

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
  if (child == null || typeof child !== "object" || !("props" in child)) {
    return <pre>{children}</pre>;
  }
  const props = (child as { props?: { className?: unknown } }).props;
  const className =
    typeof props?.className === "string" ? props.className : undefined;
  const normalized = normalizeFenceLang(extractLangFromClass(className));
  if (normalized) {
    return <pre data-lang={normalized}>{children}</pre>;
  }
  if (className && /(?:^|\s)hljs(?:\s|$)/.test(className)) {
    const stripped =
      className
        .split(/\s+/)
        .filter((cls) => cls && cls !== "hljs")
        .join(" ") || undefined;
    return <pre>{cloneElement(child as ReactElement, { className: stripped })}</pre>;
  }
  return <pre>{children}</pre>;
}
