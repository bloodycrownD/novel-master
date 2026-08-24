/**
 * WebView 侧 Mermaid 渲染共享核心（rich-document 预览 + chat-transcript 聊天两管线）。
 *
 * 约束（见 docs/Iterations/markdown-preview-mermaid/spec.md）：
 * - 无 JSX、无 RN 组件树；mermaid 以依赖形式打进各自 IIFE bundle（file:// 禁网络）。
 * - sanitize 白名单不含 SVG：RN 侧只产消毒后的 `pre>code.language-mermaid`，
 *   SVG 只能在 WebView 内由本模块生成。
 * - 消毒后的源码 <pre> 移入 display:none 的保留容器（textContent 不变），
 *   批注 renderStart/End 的文本流不被破坏；失败保留源码 + mermaid-failed 标识。
 * - 主题按 documentElement 的 --bg 亮度推断 dark/default（不扩展 HostTheme payload）。
 */

export type MermaidTheme = 'dark' | 'default';

/** 解析 #rgb/#rrggbb/#rrggbbaa/rgb() 颜色为 [r,g,b]；无法解析返回 null。 */
export function parseColorToRgb(color: string): [number, number, number] | null {
  const trimmed = color.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(trimmed);
  if (m) {
    const hex = m[1]!;
    if (hex.length === 3 || hex.length === 4) {
      return [
        parseInt(hex[0]! + hex[0]!, 16),
        parseInt(hex[1]! + hex[1]!, 16),
        parseInt(hex[2]! + hex[2]!, 16),
      ];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    return null;
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed);
  if (m) {
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return null;
}

/** 按背景亮度推断主题：暗底 dark，亮底 default；无法解析按 default。 */
export function inferMermaidThemeFromBg(
  bg: string | null | undefined,
): MermaidTheme {
  if (!bg) {
    return 'default';
  }
  const rgb = parseColorToRgb(bg);
  if (!rgb) {
    return 'default';
  }
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance < 0.5 ? 'dark' : 'default';
}

let mermaidIdCounter = 0;

/** 每次渲染唯一 id（自增），避免并发渲染共用固定 id 冲突。 */
export function nextMermaidId(): string {
  mermaidIdCounter += 1;
  return `nm-mmd-${mermaidIdCounter}`;
}

let mermaidMod: typeof import('mermaid')['default'] | null = null;

/** 懒加载 bundle 内 mermaid（IIFE 无分包，动态 import 已内联）。 */
export async function loadMermaid(): Promise<typeof import('mermaid')['default']> {
  if (!mermaidMod) {
    mermaidMod = (await import('mermaid')).default;
  }
  return mermaidMod;
}

/** 渲染单张图表；失败时清理 mermaid 残留的 d<id> 错误元素后抛出。 */
export async function renderMermaidSvg(
  id: string,
  source: string,
  theme: MermaidTheme,
): Promise<string> {
  const mermaid = await loadMermaid();
  mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' });
  try {
    const { svg } = await mermaid.render(id, source);
    return svg;
  } catch (err) {
    const leftover = document.getElementById(`d${id}`);
    if (leftover) {
      leftover.remove();
    }
    throw err;
  }
}

/**
 * 统一错误消息提取口径（双端一致）：Error 取 message，
 * mermaid DetailedError 取 str，其余 String 兑底。
 */
export function extractMermaidErrorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : String((err as { str?: unknown }).str ?? err);
}

export interface MermaidSourceCache {
  lookup(theme: MermaidTheme, source: string): string | null;
  isFailed(theme: MermaidTheme, source: string): boolean;
  /** 命中缓存直接返回；失败标记直接同错拒绝；并发同源请求合并；否则调 render。 */
  getOrCreate(
    theme: MermaidTheme,
    source: string,
    render: (id: string) => Promise<string>,
  ): Promise<string>;
}

function cacheKey(theme: MermaidTheme, source: string): string {
  return `${theme}\u0000${source}`;
}

/**
 * 按主题+源码去重缓存：同一源码多次触发只渲染一次（成功与失败都缓存）。
 */
export function createMermaidSourceCache(): MermaidSourceCache {
  const svgCache = new Map<string, string>();
  const failedCache = new Map<string, unknown>();
  const inflight = new Map<string, Promise<string>>();
  return {
    lookup(theme, source) {
      return svgCache.get(cacheKey(theme, source)) ?? null;
    },
    isFailed(theme, source) {
      return failedCache.has(cacheKey(theme, source));
    },
    getOrCreate(theme, source, render) {
      const key = cacheKey(theme, source);
      const cached = svgCache.get(key);
      if (cached != null) {
        return Promise.resolve(cached);
      }
      const failed = failedCache.get(key);
      if (failed !== undefined) {
        return Promise.reject(failed);
      }
      const pending = inflight.get(key);
      if (pending) {
        return pending;
      }
      const job = render(nextMermaidId())
        .then((svg) => {
          svgCache.set(key, svg);
          return svg;
        })
        .catch((err) => {
          failedCache.set(key, err);
          throw err;
        })
        .finally(() => {
          inflight.delete(key);
        });
      inflight.set(key, job);
      return job;
    },
  };
}

/** 从 documentElement 的 --bg CSS 变量读取当前主题。 */
export function readMermaidThemeFromDocument(): MermaidTheme {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return 'default';
  }
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg');
  return inferMermaidThemeFromBg(bg);
}

export interface RenderMermaidCodeBlocksOptions {
  /** 返回 true 的 code 节点跳过（如聊天流式尾增量岛）。 */
  skip?: (code: Element) => boolean;
}

/**
 * 扫描 root 下未处理的 `code.language-mermaid`：渲染 SVG 插入图表容器，
 * 并把源码 <pre> 移入容器（文本流顺序不变），源码容器 display:none 由共享 CSS 控制。
 * 只操作 mermaid 节点自身与新建容器，不重排周边 DOM。返回处理（含失败）的块数。
 */
export async function renderMermaidCodeBlocks(
  root: ParentNode,
  cache: MermaidSourceCache,
  options: RenderMermaidCodeBlocksOptions = {},
): Promise<number> {
  const codes = root.querySelectorAll('code.language-mermaid');
  if (!codes || codes.length === 0) {
    return 0;
  }
  const theme = readMermaidThemeFromDocument();
  let handled = 0;
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i] as HTMLElement;
    if (options.skip && options.skip(code)) {
      continue;
    }
    const pre = code.parentElement;
    if (!pre || pre.tagName !== 'PRE') {
      continue;
    }
    if (pre.getAttribute('data-mermaid') === 'done') {
      continue;
    }
    const source = code.textContent || '';
    handled += 1;
    try {
      const svg = await cache.getOrCreate(theme, source, (id) =>
        renderMermaidSvg(id, source, theme),
      );
      const block = document.createElement('div');
      block.className = 'mermaid-block';
      const chart = document.createElement('div');
      chart.className = 'mermaid-block__chart';
      chart.innerHTML = svg;
      pre.parentNode?.insertBefore(block, pre);
      block.appendChild(chart);
      // 源码 pre 移入保留容器：textContent 与文本流顺序不变，成功态 display:none
      pre.classList.add('mermaid-block__source');
      block.appendChild(pre);
      pre.setAttribute('data-mermaid', 'done');
    } catch (err) {
      // 错误消息挂 code：CSS ::before 的 attr() 只能读伪元素宿主自身属性（pre 上的读不到）
      code.setAttribute('data-mermaid-error', extractMermaidErrorMessage(err));
      pre.setAttribute('data-mermaid', 'failed');
      pre.classList.add('mermaid-failed');
    }
  }
  return handled;
}
