/**
 * T-MV1~T-MV3 / T-MT1~T-MT3：WebView 侧 mermaid 渲染契约与纯逻辑。
 * DOM 替换行为按本仓惯例钉源码契约（Jest 为 RN 环境，无 jsdom）；
 * 消毒管线、主题推断与按源码去重为真实单测。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
  CHAT_TRANSCRIPT_RICH_CSS,
  RICH_DOCUMENT_RICH_CSS,
} from '@/web/shared/rich-content-styles';
import {
  createMermaidSourceCache,
  extractMermaidErrorMessage,
  inferMermaidThemeFromBg,
  parseColorToRgb,
} from '@/web/shared/mermaid-core';
import {prepareTranscriptRichHtml} from '@/components/rich-content/prepare-transcript-rich-html';
import {readWebViewDistFile} from './helpers/read-webview-dist';

const webSrc = (rel: string) =>
  readFileSync(join(__dirname, '../src/web', rel), 'utf8');

describe('mermaid shared core (T-MV2 纯逻辑)', () => {
  it('parseColorToRgb 支持 hex 缩写/全写与 rgb()', () => {
    expect(parseColorToRgb('#abc')).toEqual([170, 187, 204]);
    expect(parseColorToRgb('#0e0f12')).toEqual([14, 15, 18]);
    expect(parseColorToRgb('rgb(255, 255, 240)')).toEqual([255, 255, 240]);
    expect(parseColorToRgb('var(--x)')).toBeNull();
    expect(parseColorToRgb('')).toBeNull();
  });

  it('inferMermaidThemeFromBg：暗底 dark / 亮底 default / 未知 default', () => {
    expect(inferMermaidThemeFromBg('#0e0f12')).toBe('dark');
    expect(inferMermaidThemeFromBg('rgb(10,10,10)')).toBe('dark');
    expect(inferMermaidThemeFromBg('#e4eaf3')).toBe('default');
    expect(inferMermaidThemeFromBg('#ffffff')).toBe('default');
    expect(inferMermaidThemeFromBg(null)).toBe('default');
    expect(inferMermaidThemeFromBg('')).toBe('default');
  });

  it('T-MT3: 同一源码多次触发只渲染一次；失败缓存不重跑且可查', async () => {
    const cache = createMermaidSourceCache();
    let okCalls = 0;
    const renderOk = async () => {
      okCalls += 1;
      return '<svg>ok</svg>';
    };
    await expect(
      cache.getOrCreate('default', 'graph TD\nA-->B', renderOk),
    ).resolves.toBe('<svg>ok</svg>');
    await expect(
      cache.getOrCreate('default', 'graph TD\nA-->B', renderOk),
    ).resolves.toBe('<svg>ok</svg>');
    expect(okCalls).toBe(1);
    expect(cache.lookup('default', 'graph TD\nA-->B')).toBe('<svg>ok</svg>');

    let failCalls = 0;
    const renderFail = async () => {
      failCalls += 1;
      throw new Error('parse error');
    };
    await expect(
      cache.getOrCreate('default', 'broken', renderFail),
    ).rejects.toThrow('parse error');
    await expect(
      cache.getOrCreate('default', 'broken', renderFail),
    ).rejects.toThrow('parse error');
    expect(failCalls).toBe(1);
    expect(cache.isFailed('default', 'broken')).toBe(true);

    // T-MV2: 失败后 reject 的原因可按统一口径提取错误消息
    const reason = await cache
      .getOrCreate('default', 'broken', renderFail)
      .catch((e: unknown) => e);
    expect(extractMermaidErrorMessage(reason)).toBe('parse error');
    expect(extractMermaidErrorMessage({str: 'Parse error on line 2'})).toBe(
      'Parse error on line 2',
    );
    expect(extractMermaidErrorMessage('boom')).toBe('boom');

    // 主题不同 → key 不同，须重跑
    await expect(
      cache.getOrCreate('dark', 'graph TD\nA-->B', renderOk),
    ).resolves.toBe('<svg>ok</svg>');
    expect(okCalls).toBe(2);
  });
});

describe('mermaid rich-document 预览管线 (T-MV1 / T-MV2)', () => {
  it('T-MV1: main.ts 在 setDocument 视图刷新后挂接 mermaid runtime', () => {
    const main = webSrc('rich-document/webview/main.ts');
    expect(main).toContain("from './runtime/mermaid'");
    expect(main).toContain('renderMermaidBlocks');
    // mermaid 渲染完成后再重建 Recogito（批注按最终 DOM 文本流计算）
    expect(main).toMatch(
      /renderMermaidBlocks\(docRoot\)[\s\S]*refreshAnnotateAfterDocument/,
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
    expect(core).toContain('extractMermaidErrorMessage');
    // 只操作 mermaid 节点自身：源码 pre 移入新建容器，文本流顺序不变
    expect(core).toContain('insertBefore(block, pre)');
    expect(core).toContain('block.appendChild(pre)');

    const runtime = webSrc('rich-document/webview/runtime/mermaid.ts');
    expect(runtime).toContain('renderMermaidCodeBlocks');

    const dist = readWebViewDistFile('rich-document', 'app.js');
    expect(dist).toContain('renderMermaidBlocks');
    expect(dist).toContain('language-mermaid');
    expect(dist).toContain('mermaid.initialize');
    expect(dist).toContain('data-mermaid-error');

    // dist 两管线均含错误属性（JS）与 attr 展示（CSS）
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
    const html = prepareTranscriptRichHtml(
      '```mermaid\nflowchart TD\nA-->B\n```',
    );
    expect(html).toContain('language-mermaid');
    expect(html).toContain('<pre>');
    expect(html).toContain('<code');
  });
});

describe('mermaid chat-transcript 聊天管线 (T-MT1 / T-MT2)', () => {
  const snapshot = () =>
    webSrc('chat-transcript/webview/runtime/render/snapshot.ts');
  const bridge = () =>
    webSrc('chat-transcript/webview/runtime/bridge/bridge.ts');
  const stream = () =>
    webSrc('chat-transcript/webview/runtime/stream/stream.ts');

  it('T-MT1: sessionSnapshot/prependPage/appendTailRows/streamCommit 渲染后触发', () => {
    const src = snapshot();
    // 5 处：applySnapshot / applyAppendTailRows / applyStreamCommit×2（早退与 promote 后）/ applyPrependPage
    expect(src.match(/scheduleMermaidScan\(\)/g)).toHaveLength(5);
    expect(src).toContain("from '../mermaid'");

    const dist = readWebViewDistFile('chat-transcript', 'app.js');
    expect(dist).toContain('scheduleMermaidScan');
    expect(dist).toContain('language-mermaid');
  });

  it('T-MT2: 流式 delta/batch 路径不触发 mermaid 渲染；流式尾子树跳过', () => {
    expect(stream()).not.toContain('mermaid');
    expect(stream()).not.toContain('Mermaid');

    const bridgeSrc = bridge();
    expect(bridgeSrc).not.toContain('scheduleMermaidScan');

    const runtime = webSrc('chat-transcript/webview/runtime/mermaid.ts');
    // 懒加载 + 防抖 + 流式尾增量岛跳过
    expect(runtime).toContain('setTimeout');
    expect(runtime).toContain("closest('#stream-tail')");
    expect(runtime).toMatch(/150/);
  });
});
