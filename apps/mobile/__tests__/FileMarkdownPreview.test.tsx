import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

const mockReadEngine = jest.fn(async () => 'webview' as const);

jest.mock('@/runtime/novel-master-context', () => ({
  useNovelMaster: () => ({appUi: {get: jest.fn()}}),
}));

jest.mock('@/storage/vfs-markdown-preview-engine', () => ({
  defaultVfsMarkdownPreviewEngine: () => 'webview',
  readVfsMarkdownPreviewEngine: (...args: unknown[]) => mockReadEngine(...args),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => cb(),
}));

jest.mock('@/components/rich-content/sanitize-rich-html', () => ({
  sanitizeRichHtml: (html: string) => html,
}));

jest.mock('@/components/vfs/RichDocumentWebView', () => ({
  RichDocumentWebView: jest.fn((props: Record<string, unknown>) => {
    const React = require('react');
    const {View} = require('react-native');
    return React.createElement(View, {
      testID: 'rich-document-webview',
      ...props,
    });
  }),
}));

import {FileMarkdownPreview} from '@/components/vfs/FileMarkdownPreview';
import {RichDocumentWebView} from '@/components/vfs/RichDocumentWebView';
import {RICH_CONTENT_MAX_CHARS, RICH_DOCUMENT_WEBVIEW_MAX_CHARS} from '@/components/rich-content/rich-content-limits';

const mockRichDocumentWebView = RichDocumentWebView as jest.MockedFunction<
  typeof RichDocumentWebView
>;

jest.mock('@/components/rich-content/RichContentBody', () => ({
  RichContentBody: () => {
    const React = require('react');
    const {View} = require('react-native');
    return React.createElement(View, {testID: 'rich-content-body'});
  },
}));

const tokens = {
  background: '#000',
  surface: '#111',
  bgSecondary: '#222',
  border: '#333',
  borderLight: '#444',
  text: '#fff',
  textSecondary: '#aaa',
  primary: '#08f',
  danger: '#f00',
};

describe('FileMarkdownPreview', () => {
  beforeEach(() => {
    mockReadEngine.mockReset();
    mockReadEngine.mockResolvedValue('webview');
    mockRichDocumentWebView.mockClear();
  });

  it('mounts RichDocumentWebView when webview flag and closed FM body', async () => {
    const content = `---
title: Test
---
# Hello

- item one
`;
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FileMarkdownPreview
          path="/notes/readme.md"
          content={content}
          tokens={tokens}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      tree!.root.findByProps({testID: 'rich-document-webview'}),
    ).toBeTruthy();
    const lastCall = mockRichDocumentWebView.mock.calls.at(-1)?.[0];
    expect(lastCall?.frontMatterHtml).toContain('fm-card');
    expect(lastCall?.frontMatterHtml).toContain('title');
  });

  it('mounts RichContentBody when rn flag', async () => {
    mockReadEngine.mockResolvedValue('rn');
    const content = `---
title: Test
---
Hello body
`;
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FileMarkdownPreview
          path="/notes/readme.md"
          content={content}
          tokens={tokens}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(tree!.root.findByProps({testID: 'rich-content-body'})).toBeTruthy();
  });

  it('passes plain + overLimit to RichDocumentWebView when body exceeds webview char cap (T7)', async () => {
    const longBody = 'x'.repeat(RICH_DOCUMENT_WEBVIEW_MAX_CHARS + 1);
    const content = `---
title: Long
---
${longBody}`;
    await act(async () => {
      TestRenderer.create(
        <FileMarkdownPreview
          path="/notes/long.md"
          content={content}
          tokens={tokens}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockRichDocumentWebView).toHaveBeenCalled();
    const lastCall = mockRichDocumentWebView.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({
      plain: longBody,
      overLimit: true,
      html: undefined,
    });
    expect(lastCall?.frontMatterHtml).toContain('fm-card');
  });

  it('body over legacy 12k cap but within webview cap renders markdown (2026-09-19 放宽回归锚点)', async () => {
    // 两三万字正文（旧 12k 阈值即回退纯文本）：WebView 引擎下应正常渲染，
    // 不再误判超长——fm-card HTML 透出的触发面随之消失。
    const novelBody = '章'.repeat(RICH_CONTENT_MAX_CHARS + 18_000);
    const content = `---
title: Novel
---
${novelBody}`;
    await act(async () => {
      TestRenderer.create(
        <FileMarkdownPreview
          path="/notes/novel.md"
          content={content}
          tokens={tokens}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const lastCall = mockRichDocumentWebView.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({
      overLimit: false,
    });
    expect(typeof lastCall?.html).toBe('string');
    expect(lastCall?.html.length).toBeGreaterThan(0);
  });

  it('renderKind txt shows plain source and does not mount RichDocumentWebView', async () => {
    const content = `---
title: Test
---
# Hello

- item one
`;
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FileMarkdownPreview
          path="/notes/readme.md"
          content={content}
          tokens={tokens}
          renderKind="txt"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(() =>
      tree!.root.findByProps({testID: 'rich-document-webview'}),
    ).toThrow();
    const textNodes = tree!.root.findAllByType(
      require('react-native').Text as React.ComponentType,
    );
    const combined = textNodes.map(n => n.props.children).join('');
    expect(combined).toContain('---');
    expect(combined).toContain('# Hello');
    expect(combined).toContain('title: Test');
  });

  it('renderKind txt renders selectable Text for long-press copy (T-FP1)', async () => {
    const content = '# Hello\n\nplain body';
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FileMarkdownPreview
          path="/notes/readme.txt"
          content={content}
          tokens={tokens}
          renderKind="txt"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const Text = require('react-native').Text as React.ComponentType;
    const textNodes = tree!.root.findAllByType(Text);
    const bodyNode = textNodes.find(n =>
      String(n.props.children).includes('# Hello'),
    );
    expect(bodyNode).toBeTruthy();
    expect(bodyNode!.props.selectable).toBe(true);
  });

  it('renderKind markdown (default) still mounts WebView when webview engine', async () => {
    const content = `---
title: Test
---
# Hello
`;
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FileMarkdownPreview
          path="/notes/readme.md"
          content={content}
          tokens={tokens}
          renderKind="markdown"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      tree!.root.findByProps({testID: 'rich-document-webview'}),
    ).toBeTruthy();
  });

  it('renders unclosed front matter as body without FM card (T-FM4)', async () => {
    const content = `---
title: broken
no closing fence
# Body`;
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FileMarkdownPreview
          path="/notes/readme.md"
          content={content}
          tokens={tokens}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    // Unclosed FM is treated as no FM — body renders normally.
    expect(
      tree!.root.findByProps({testID: 'rich-document-webview'}),
    ).toBeTruthy();
    const lastCall = mockRichDocumentWebView.mock.calls.at(-1)?.[0];
    expect(lastCall?.frontMatterHtml).toBeUndefined();
    // plain is the full content as body (unclosed `---` becomes normal markdown).
    expect(lastCall?.plain).toContain('# Body');
  });

  it('renders closed FM with empty body only once (T-FM5)', async () => {
    const content = `---
title: x
---
`;
    await act(async () => {
      TestRenderer.create(
        <FileMarkdownPreview
          path="/notes/empty-body.md"
          content={content}
          tokens={tokens}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockRichDocumentWebView).toHaveBeenCalled();
    const lastCall = mockRichDocumentWebView.mock.calls.at(-1)?.[0];
    // FM card should render once at top.
    expect(lastCall?.frontMatterHtml).toContain('fm-card');
    expect(lastCall?.frontMatterHtml).toContain('title');
    // plain should be empty — not echoing the FM block back.
    expect(lastCall?.plain).toBe('');
    expect(lastCall?.plain).not.toContain('---');
    expect(lastCall?.plain).not.toContain('title: x');
  });

  it('non-md txt with previewFill wraps content in ScrollView (T1)', async () => {
    const content = 'line one\n'.repeat(80);
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FileMarkdownPreview
          path="/notes/readme.txt"
          content={content}
          tokens={tokens}
          previewFill
          renderKind="txt"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      tree!.root.findAllByType(
        require('react-native').ScrollView as React.ComponentType,
      ).length,
    ).toBeGreaterThan(0);
  });

  it('non-md markdown tab renders plain source, no markdown parse (T2, 2026-09-19 拍板)', async () => {
    // 非 md 文件的 Markdown Tab 与文本 Tab 同款纯文本——不再 markdown 化全文
    const content = '# Heading\n\n- item';
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FileMarkdownPreview
          path="/notes/readme.txt"
          content={content}
          tokens={tokens}
          renderKind="markdown"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(() =>
      tree!.root.findByProps({testID: 'rich-document-webview'}),
    ).toThrow();
    expect(() =>
      tree!.root.findByProps({testID: 'rich-content-body'}),
    ).toThrow();
    const textNodes = tree!.root.findAllByType(
      require('react-native').Text as React.ComponentType,
    );
    const combined = textNodes.map(n => n.props.children).join('');
    // 原文按字面显示：# 不再变标题、- 不再变列表
    expect(combined).toContain('# Heading');
    expect(combined).toContain('- item');
  });

  it('non-md yaml markdown tab shows raw yaml as plain text (2026-09-19 拍板回归锚点)', async () => {
    const content = '# yaml 注释\nkey: value\nnested:\n  - a\n  - b\n';
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FileMarkdownPreview
          path="/notes/config.yaml"
          content={content}
          tokens={tokens}
          renderKind="markdown"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(() =>
      tree!.root.findByProps({testID: 'rich-document-webview'}),
    ).toThrow();
    const textNodes = tree!.root.findAllByType(
      require('react-native').Text as React.ComponentType,
    );
    const combined = textNodes.map(n => n.props.children).join('');
    expect(combined).toContain('# yaml 注释');
    expect(combined).toContain('  - a');
  });

  it('non-md txt tab does not mount RichDocumentWebView (T3)', async () => {
    const content = '# Not rendered as markdown';
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FileMarkdownPreview
          path="/notes/readme.txt"
          content={content}
          tokens={tokens}
          renderKind="txt"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(() =>
      tree!.root.findByProps({testID: 'rich-document-webview'}),
    ).toThrow();
  });
});
