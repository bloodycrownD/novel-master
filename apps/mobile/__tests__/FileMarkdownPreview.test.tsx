import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

const mockReadEngine = jest.fn(async () => 'webview' as const);

jest.mock('../src/runtime/novel-master-context', () => ({
  useNovelMaster: () => ({appUi: {get: jest.fn()}}),
}));

jest.mock('../src/storage/vfs-markdown-preview-engine', () => ({
  defaultVfsMarkdownPreviewEngine: () => 'webview',
  readVfsMarkdownPreviewEngine: (...args: unknown[]) => mockReadEngine(...args),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => cb(),
}));

jest.mock('../src/components/vfs/RichDocumentWebView', () => ({
  RichDocumentWebView: jest.fn((props: Record<string, unknown>) => {
    const React = require('react');
    const {View} = require('react-native');
    return React.createElement(View, {testID: 'rich-document-webview', ...props});
  }),
}));

import {FileMarkdownPreview} from '../src/components/vfs/FileMarkdownPreview';
import {RichDocumentWebView} from '../src/components/vfs/RichDocumentWebView';
import {RICH_CONTENT_MAX_CHARS} from '../src/components/rich-content/rich-content-limits';

const mockRichDocumentWebView = RichDocumentWebView as jest.MockedFunction<
  typeof RichDocumentWebView
>;

jest.mock('../src/components/rich-content/RichContentBody', () => ({
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
    expect(tree!.root.findByProps({testID: 'rich-document-webview'})).toBeTruthy();
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

  it('passes plain + overLimit to RichDocumentWebView when body exceeds char cap (T7)', async () => {
    const longBody = 'x'.repeat(RICH_CONTENT_MAX_CHARS + 1);
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
    expect(() => tree!.root.findByProps({testID: 'rich-document-webview'})).toThrow();
    const textNodes = tree!.root.findAllByType(
      require('react-native').Text as React.ComponentType,
    );
    const combined = textNodes.map(n => n.props.children).join('');
    expect(combined).toContain('---');
    expect(combined).toContain('# Hello');
    expect(combined).toContain('title: Test');
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
    expect(tree!.root.findByProps({testID: 'rich-document-webview'})).toBeTruthy();
  });

  it('does not render Web body when front matter is unclosed', async () => {
    const content = `---
title: broken
no closing fence
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
    expect(() => tree!.root.findByProps({testID: 'rich-document-webview'})).toThrow();
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
      tree!.root.findAllByType(require('react-native').ScrollView as React.ComponentType)
        .length,
    ).toBeGreaterThan(0);
  });

  it('non-md markdown tab mounts RichDocumentWebView when webview engine (T2)', async () => {
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
    expect(tree!.root.findByProps({testID: 'rich-document-webview'})).toBeTruthy();
  });

  it('non-md markdown tab mounts RichContentBody when rn engine (T2)', async () => {
    mockReadEngine.mockResolvedValue('rn');
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
    expect(tree!.root.findByProps({testID: 'rich-content-body'})).toBeTruthy();
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
    expect(() => tree!.root.findByProps({testID: 'rich-document-webview'})).toThrow();
  });
});
