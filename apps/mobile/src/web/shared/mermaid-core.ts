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

type MermaidTheme = 'dark' | 'default';

/**
 * getOrCreate 的单体渲染结果：web bundle 不引 core errors（build-webview 的
 * WEBVIEW_CORE_ALLOWLIST 门禁），本地定义与 `Result<T, unknown>` 同构的判别联合。
 */
type MermaidRenderOutcome = {ok: true; svg: string} | {ok: false; error: unknown};

// 颜色解析与亮度推断已抽至 theme-mode.ts（代码高亮 token 配色同样需要）。
import {ThemeMode} from './theme-mode';

/** mermaid 渲染 id 计数器（模块内 holder，对象管理）。 */
const mermaidIds = { counter: 0 };

/** 懒加载的 mermaid 模块槽（模块内 holder，对象管理；null = 未加载）。 */
const mermaidModuleSlot = {
    mod: null as typeof import('mermaid')['default'] | null,
};

interface MermaidSourceCache {
    lookup(theme: MermaidTheme, source: string): string | null;
    isFailed(theme: MermaidTheme, source: string): boolean;
    /** 命中缓存直接返回；失败标记直接同错返回 Err；并发同源请求合并；否则调 render。 */
    getOrCreate(theme: MermaidTheme, source: string, render: (id: string) => Promise<string>): Promise<MermaidRenderOutcome>;
}

interface RenderMermaidCodeBlocksOptions {
    /** 返回 true 的 code 节点跳过（如聊天流式尾增量岛）。 */
    skip?: (code: Element) => boolean;
}

export const MermaidCore = {
    /** 按背景亮度推断主题：暗底 dark，亮底 default；无法解析按 default。 */
    inferThemeFromBg: (bg: string | null | undefined): MermaidTheme => {
        return ThemeMode.inferFromBg(bg) === 'dark' ? 'dark' : 'default';
    },

    /** 每次渲染唯一 id（自增），避免并发渲染共用固定 id 冲突。 */
    nextId: (): string => {
        mermaidIds.counter += 1;
        return `nm-mmd-${mermaidIds.counter}`;
    },

    /** 懒加载 bundle 内 mermaid（IIFE 无分包，动态 import 已内联）。 */
    load: async (): Promise<typeof import('mermaid')['default']> => {
        if (!mermaidModuleSlot.mod) {
            mermaidModuleSlot.mod = (await import('mermaid')).default;
        }
        return mermaidModuleSlot.mod;
    },

    /** 渲染单张图表；失败时清理 mermaid 残留的 d<id> 错误元素后抛出。 */
    renderSvg: async (id: string, source: string, theme: MermaidTheme): Promise<string> => {
        const mermaid = await MermaidCore.load();
        mermaid.initialize({startOnLoad: false, theme, securityLevel: 'strict'});
        try {
            const {svg} = await mermaid.render(id, source);
            return svg;
        } catch (err) {
            const leftover = document.getElementById(`d${id}`);
            if (leftover) {
                leftover.remove();
            }
            // nm-throw: keep — mermaid 第三方 SDK 的 render 只以 reject 报错：catch 只清理 d<id> 残留错误元素后原样透传，终端 renderCodeBlocks 的 catch 收口成 UI 失败标记
            throw err;
        }
    },

    /**
   * 统一错误消息提取口径（双端一致）：Error 取 message，
   * mermaid DetailedError 取 str，其余 String 兑底。
   */
    extractErrorMessage: (err: unknown): string => {
        return err instanceof Error ? err.message : String((err as {str?: unknown}).str ?? err);
    },

    cacheKey: (theme: MermaidTheme, source: string): string => {
        return `${theme}\u0000${source}`;
    },

    /**
   * 按主题+源码去重缓存：同一源码多次触发只渲染一次（成功与失败都缓存）。
   */
    createSourceCache: (): MermaidSourceCache => {
        const svgCache = new Map<string, string>();
        const failedCache = new Map<string, unknown>();
        const inflight = new Map<string, Promise<MermaidRenderOutcome>>();
        return {
            lookup(theme, source) {
                return svgCache.get(MermaidCore.cacheKey(theme, source)) ?? null;
            },
            isFailed(theme, source) {
                return failedCache.has(MermaidCore.cacheKey(theme, source));
            },
            getOrCreate(theme, source, render) {
                const key = MermaidCore.cacheKey(theme, source);
                const cached = svgCache.get(key);
                if (cached != null) {
                    return Promise.resolve({ok: true, svg: cached});
                }
                const failed = failedCache.get(key);
                if (failed !== undefined) {
                    return Promise.resolve({ok: false, error: failed});
                }
                const pending = inflight.get(key);
                if (pending) {
                    return pending;
                }
                // render（MermaidCore.renderSvg）按第三方契约以 reject 报错，这里
                // 统一转收成 outcome：失败登记 failedCache 后沿 Err 返回，不再 rethrow。
                const job = render(MermaidCore.nextId())
                    .then(svg => {
                        svgCache.set(key, svg);
                        return {ok: true, svg} as const;
                    })
                    .catch(err => {
                        failedCache.set(key, err);
                        return {ok: false, error: err} as const;
                    })
                    .finally(() => {
                        inflight.delete(key);
                    });
                inflight.set(key, job);
                return job;
            },
        };
    },

    /** 从 documentElement 的 --bg CSS 变量读取当前主题。 */
    readThemeFromDocument: (): MermaidTheme => {
        if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
            return 'default';
        }
        // 宿主未下发 --bg（条件式写入缺省）时按 #fff 亮底兜底，与 CSS var(--bg, #fff) 口径一致
        const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#fff';
        return MermaidCore.inferThemeFromBg(bg);
    },

    /**
   * 扫描 root 下未处理的 `code.language-mermaid`：渲染 SVG 插入图表容器，
   * 并把源码 <pre> 移入容器（文本流顺序不变），源码容器 display:none 由共享 CSS 控制。
   * 只操作 mermaid 节点自身与新建容器，不重排周边 DOM。返回处理（含失败）的块数。
   */
    renderCodeBlocks: async (root: ParentNode, cache: MermaidSourceCache, options: RenderMermaidCodeBlocksOptions = {}): Promise<number> => {
        const codes = root.querySelectorAll('code.language-mermaid');
        if (!codes || codes.length === 0) {
            return 0;
        }
        const theme = MermaidCore.readThemeFromDocument();
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
                const rendered = await cache.getOrCreate(theme, source, id => MermaidCore.renderSvg(id, source, theme));
                if (!rendered.ok) {
                    // 错误消息挂 code：CSS ::before 的 attr() 只能读伪元素宿主自身属性（pre 上的读不到）
                    code.setAttribute('data-mermaid-error', MermaidCore.extractErrorMessage(rendered.error));
                    pre.setAttribute('data-mermaid', 'failed');
                    pre.classList.add('mermaid-failed');
                    continue;
                }
                const svg = rendered.svg;
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
                // 渲染失败已由上方 !ok 分支收口；catch 只兜 DOM 装配等意外，失败标记口径同款。
                code.setAttribute('data-mermaid-error', MermaidCore.extractErrorMessage(err));
                pre.setAttribute('data-mermaid', 'failed');
                pre.classList.add('mermaid-failed');
            }
        }
        return handled;
    },
} as const;
