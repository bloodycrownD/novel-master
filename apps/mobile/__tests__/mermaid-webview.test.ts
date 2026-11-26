/**
 * T-MV1~T-MV3 / T-MT1~T-MT3：WebView 侧 mermaid 渲染契约与纯逻辑。
 * DOM 替换行为按本仓惯例钉源码契约（Jest 为 RN 环境，无 jsdom）；
 * 消毒管线、主题推断与按源码去重为真实单测。
 */
import {readFileSync} from 'node:fs';
import {ThemeMode} from '@web/shared/theme-mode';
import {join} from 'node:path';
import {
    CHAT_TRANSCRIPT_RICH_CSS,
    RICH_DOCUMENT_RICH_CSS,
} from '../src/web/shared/rich-content-styles';
import {MermaidCore} from '../src/web/shared/mermaid-core';
import {TranscriptRichHtml} from '../src/components/rich-content/prepare-transcript-rich-html';
import {readWebViewDistFile} from './helpers/read-webview-dist';

const webSrc = (rel: string) =>
    readFileSync(join(__dirname, '../src/web', rel), 'utf8');

/**
 * 截取函数源码切片（G-1：脆断言改按函数切片，避免整源误报/漏报）。
 * 源码 namespace 化后 stream.ts 的函数是 `Stream` 对象成员
 * （`  name: (...) => {` … `\n  },`），切片按成员形态取。
 * 成员名找不到时 fail-fast：静默返回空串会让 not.toContain 恒真。
 */
const fnSlice = (src: string, name: string): string => {
    // 成员锚/闭合锚对缩进空白归一（缩进基线 2→4 不可再破坏结构断言）。
    const start = new RegExp(`\\n +${name}: \\(`).exec(src)?.index ?? -1;
    if (start < 0) {
        throw new Error(`fnSlice: 源码里找不到成员 ${name}（锚点契约失效）`);
    }
    const tail = src.slice(start);
    const close = /\n +},/.exec(tail)?.index ?? -1;
    if (close < 0) {
        throw new Error(`fnSlice: 成员 ${name} 的闭合锚缺失（锚点契约失效）`);
    }
    return tail.slice(0, close);
};

describe('mermaid shared core (T-MV2 纯逻辑)', () => {
    it('parseColorToRgb 支持 hex 缩写/全写与 rgb()', () => {
        expect(ThemeMode.parseColorToRgb('#abc')).toEqual([170, 187, 204]);
        expect(ThemeMode.parseColorToRgb('#0e0f12')).toEqual([14, 15, 18]);
        expect(ThemeMode.parseColorToRgb('rgb(255, 255, 240)')).toEqual([255, 255, 240]);
        expect(ThemeMode.parseColorToRgb('var(--x)')).toBeNull();
        expect(ThemeMode.parseColorToRgb('')).toBeNull();
    });

    it('inferMermaidThemeFromBg：暗底 dark / 亮底 default / 未知 default', () => {
        expect(MermaidCore.inferThemeFromBg('#0e0f12')).toBe('dark');
        expect(MermaidCore.inferThemeFromBg('rgb(10,10,10)')).toBe('dark');
        expect(MermaidCore.inferThemeFromBg('#e4eaf3')).toBe('default');
        expect(MermaidCore.inferThemeFromBg('#ffffff')).toBe('default');
        expect(MermaidCore.inferThemeFromBg(null)).toBe('default');
        expect(MermaidCore.inferThemeFromBg('')).toBe('default');
    });

    it('T-MT3: 同一源码多次触发只渲染一次；失败缓存不重跑且可查', async () => {
        const cache = MermaidCore.createSourceCache();
        let okCalls = 0;
        const renderOk = async () => {
            okCalls += 1;
            return '<svg>ok</svg>';
        };
        const okOutcome = await cache.getOrCreate('default', 'graph TD\nA-->B', renderOk);
        expect(okOutcome).toEqual({ok: true, svg: '<svg>ok</svg>'});
        const cachedOutcome = await cache.getOrCreate('default', 'graph TD\nA-->B', renderOk);
        expect(cachedOutcome).toEqual({ok: true, svg: '<svg>ok</svg>'});
        expect(okCalls).toBe(1);
        expect(cache.lookup('default', 'graph TD\nA-->B')).toBe('<svg>ok</svg>');

        let failCalls = 0;
        const renderFail = async () => {
            failCalls += 1;
            throw new Error('parse error');
        };
        const failedOutcome = await cache.getOrCreate('default', 'broken', renderFail);
        expect(failedOutcome.ok).toBe(false);
        if (!failedOutcome.ok) {
            expect(MermaidCore.extractErrorMessage(failedOutcome.error)).toBe('parse error');
            // 失败缓存命中：同错返回同一个 Err 载荷，不再重跑 render。
            const failedAgain = await cache.getOrCreate('default', 'broken', renderFail);
            expect(failedAgain).toEqual({ok: false, error: failedOutcome.error});
        }
        expect(failCalls).toBe(1);
        expect(cache.isFailed('default', 'broken')).toBe(true);

        // T-MV2: 失败后 Err.error 可按统一口径提取错误消息
        expect(MermaidCore.extractErrorMessage({str: 'Parse error on line 2'})).toBe(
            'Parse error on line 2',
        );
        expect(MermaidCore.extractErrorMessage('boom')).toBe('boom');

        // 主题不同 → key 不同，须重跑
        const darkOutcome = await cache.getOrCreate('dark', 'graph TD\nA-->B', renderOk);
        expect(darkOutcome).toEqual({ok: true, svg: '<svg>ok</svg>'});
        expect(okCalls).toBe(2);
    });
});

describe('mermaid rich-document 预览管线 (T-MV1 / T-MV2)', () => {
    it('T-MV1: main.ts 在 setDocument 视图刷新后挂接 mermaid runtime', () => {
        const main = webSrc('rich-document/webview/main.ts');
        expect(main).toContain("from './runtime/mermaid'");
        expect(main).toContain('Mermaid.render');
        // mermaid 渲染完成后再重建 Recogito（批注按最终 DOM 文本流计算）
        expect(main).toMatch(
            /Mermaid\.render\(docRoot\)[\s\S]*Annotate\.refreshAfterDocument/,
        );
    });

    it('T-MV1: rich-content-styles 单源含图表/占位/失败样式（两管线同源）', () => {
        for (const css of [CHAT_TRANSCRIPT_RICH_CSS, RICH_DOCUMENT_RICH_CSS]) {
            expect(css).toContain('.mermaid-block');
            expect(css).toContain('.mermaid-block__chart');
            expect(css).toContain('.mermaid-block__source');
            expect(css).toContain('display: none');
            expect(css).toContain('language-mermaid');
            expect(css).toContain('mermaid-failed');
            expect(css).toContain('max-width: 100%');
            // 失败原因展示：attr 带 fallback，旧 DOM（无属性）退回原文案
            expect(css).toContain('attr(data-mermaid-error');
        }
    });

    it('T-MV2: 扫描渲染保留源码隐藏、失败保留显示（源码契约 + dist）', () => {
        const core = webSrc('shared/mermaid-core.ts');
        expect(core).toContain("querySelectorAll('code.language-mermaid')");
        expect(core).toContain("classList.add('mermaid-block__source')");
        expect(core).toContain("pre.setAttribute('data-mermaid', 'done')");
        expect(core).toContain("classList.add('mermaid-failed')");
        // 失败原因：catch 接住 err，提取消息写入 data-mermaid-error
        expect(core).toContain('} catch (err) {');
        expect(core).toContain("setAttribute('data-mermaid-error'");
        expect(core).toContain('extractErrorMessage');
        // 只操作 mermaid 节点自身：源码 pre 移入新建容器，文本流顺序不变
        expect(core).toContain('insertBefore(block, pre)');
        expect(core).toContain('block.appendChild(pre)');

        const runtime = webSrc('rich-document/webview/runtime/mermaid.ts');
        expect(runtime).toContain('MermaidCore.renderCodeBlocks');

        const dist = readWebViewDistFile('rich-document', 'app.js');
        // minify 重命名 Mermaid.render / MermaidCore.renderCodeBlocks 等函数标识符，
        // 断言换该扫描器写进 DOM 的**稳定面**（选择器字面量 + 容器/失败类名）：
        // 三样都由「扫 code.language-mermaid → 造 mermaid-block 容器」这一条路径
        // 独家产出，谁把扫描器删了/断链了三样一起归零。
        expect(dist).toContain('code.language-mermaid');
        expect(dist).toContain('mermaid-block__chart');
        expect(dist).toContain('mermaid-block__source');
        expect(dist).toContain('language-mermaid');
        expect(dist).toContain('mermaid.initialize');
        expect(dist).toContain('data-mermaid-error');

        // dist 两管线均含错误属性（JS）与 attr 展示（CSS）。
        // chat 侧读 chat-transcript：composer-native-2026-10 Step 6 合成包退役，
        // 转录 dist 唯一落地面回到独立包。
        for (const pkg of ['chat-transcript', 'rich-document'] as const) {
            expect(readWebViewDistFile(pkg, 'app.js')).toContain(
                'data-mermaid-error',
            );
            expect(readWebViewDistFile(pkg, 'app.css')).toContain(
                'attr(data-mermaid-error',
            );
        }
    });
});

describe('mermaid 消毒管线 (T-MV3)', () => {
    it('sanitizeRichHtml 输出保留 language-mermaid class（消毒零改动）', () => {
        const html = TranscriptRichHtml.prepare(
            '```mermaid\nflowchart TD\nA-->B\n```',
        );
        expect(html).toContain('language-mermaid');
        expect(html).toContain('<pre>');
        expect(html).toContain('<code');
    });
});

describe('mermaid chat 转录管线 (T-MT1 / T-MT2)', () => {
    const snapshot = () =>
        webSrc('chat-transcript/webview/runtime/render/snapshot.ts');
    const bridge = () => webSrc('chat-transcript/webview/runtime/bridge.ts');
    const stream = () =>
        webSrc('chat-transcript/webview/runtime/stream/stream.ts');

    it('T-MT1: sessionSnapshot/prependPage/appendTailRows 渲染后触发', () => {
        const src = snapshot();
        // 3 处：applySnapshot / applyAppendTailRows / applyPrependPage
        // （streamCommit 路径已随协议删除，spec Step 6）
        expect(src.match(/Mermaid\.scheduleScan\(\)/g)).toHaveLength(3);
        expect(src).toContain("from '../mermaid'");

        // 源码真源仍在 chat-transcript/webview/runtime 下，
        // dist 侧读 chat-transcript（Step 6 合成包退役后的唯一落地面）。
        const dist = readWebViewDistFile('chat-transcript', 'app.js');
        // minify 重命名 scheduleMermaidScan，本体无字符串面；断言换它在产物里
        // 留下的两处稳定指纹：扫描入口的选择器 `code.language-mermaid`，以及
        // 「流式尾增量岛跳过」契约的唯一标记 `closest('#stream-tail')`
        // （只有 transcript runtime 的 mermaid 扫描器会带这个 skip 选择器）。
        expect(dist).toMatch(/closest\(["']#stream-tail["']\)/);
    expect(dist).toContain('language-mermaid');
  });

  it('T-MT2: 流式 delta/batch 路径不触发 mermaid 渲染；流式尾子树跳过', () => {
    // G-1：整源 not.toContain('mermaid') 属脆断言（P2-10 收尾补扫会命中），
    // 改按函数切片——只钉流式增量 / 块提交入口不触发图表扫描；收尾补扫由
    // chat-transcript-stream-projection 的 P2-10 直测覆盖。
    const src = stream();
    for (const name of ['applyDelta', 'appendDeltaIncremental', 'applyBlockCommit']) {
      const slice = fnSlice(src, name);
      expect(slice).not.toContain('mermaid');
      expect(slice).not.toContain('Mermaid');
      expect(slice).not.toContain('scheduleScan');
    }
    // 收尾路径补扫（P2-10）：delta/batch 不碰，finished 才触发。
    expect(fnSlice(src, 'applyStatus')).toContain('Mermaid.scheduleScan');

    const bridgeSrc = bridge();
    expect(bridgeSrc).not.toContain('scheduleMermaidScan');

    const runtime = webSrc('chat-transcript/webview/runtime/mermaid.ts');
    // 懒加载 + 防抖 + 流式尾增量岛跳过
    expect(runtime).toContain('setTimeout');
    expect(runtime).toContain("closest('#stream-tail')");
    expect(runtime).toMatch(/150/);
  });
});
