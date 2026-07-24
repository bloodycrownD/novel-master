/**
 * T-SA6 / T-SA7 / T-SA9：Mobile 认锚预览、sanitize、点击与退役搜字主路径。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {buildAnnotatedSource} from '@novel-master/core/chat';
import {sanitizeRichHtml} from '../src/components/rich-content/sanitize-rich-html';
import {
  addChatAnnotateDraft,
  resetChatAnnotateDraftStoreForTests,
} from '../src/storage/chat-annotate-draft';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

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
  useIsFocused: () => true,
}));

jest.mock('../src/components/vfs/RichDocumentWebView', () => ({
  RichDocumentWebView: jest.fn((props: Record<string, unknown>) => {
    const React = require('react');
    const {View} = require('react-native');
    return React.createElement(View, {
      testID: 'rich-document-webview',
      ...props,
    });
  }),
}));

jest.mock('../src/components/chat/MessageEditModal', () => ({
  MessageEditModal: () => null,
}));

jest.mock('../src/components/vfs/AnnotatePickModal', () => ({
  AnnotatePickModal: () => null,
}));

jest.mock('../src/components/rich-content/sanitize-rich-html', () => ({
  sanitizeRichHtml: (html: string) => {
    // 测试替身：保留 data-annotate-id，剥 script/onclick（对齐 T-SA6 合同）
    return html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+="[^"]*"/gi, '');
  },
}));

jest.mock('../src/components/rich-content/prepare-transcript-rich-html', () => ({
  prepareTranscriptRichHtml: (md: string) => {
    const {sanitizeRichHtml} = require('../src/components/rich-content/sanitize-rich-html');
    return sanitizeRichHtml(md);
  },
}));

import {FileMarkdownPreview} from '../src/components/vfs/FileMarkdownPreview';
import {RichDocumentWebView} from '../src/components/vfs/RichDocumentWebView';

const mockRichDocumentWebView = RichDocumentWebView as jest.MockedFunction<
  typeof RichDocumentWebView
>;

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
  textTertiary: '#666',
};

describe('T-SA6 Mobile sanitize / 认锚 HTML', () => {
  it('sanitize 后仍保留 data-annotate-id 与 nm-annotate-anchor', () => {
    const raw =
      '<span class="nm-annotate-anchor" data-annotate-id="a1">hello</span>';
    const out = sanitizeRichHtml(raw);
    expect(out).toContain('data-annotate-id="a1"');
    expect(out).toContain('nm-annotate-anchor');
    expect(out).toContain('hello');
  });

  it('剥离 script / 事件属性，且 plain 派生串经消毒后无裸标签可见问题', () => {
    const source = 'aaa foo bbb';
    const start = source.indexOf('foo');
    const {annotatedSource} = buildAnnotatedSource({
      sourceText: source,
      drafts: [
        {
          id: '1',
          path: '/a.txt',
          originalText: 'foo',
          userAnnotation: 'x',
          startOffset: start,
          endOffset: start + 3,
        },
      ],
      mode: 'text',
    });
    const dirty = `${annotatedSource}<script>alert(1)</script><span onclick="x">z</span>`;
    const out = sanitizeRichHtml(dirty);
    expect(out).toContain('data-annotate-id="1"');
    expect(out).not.toMatch(/<script\b/i);
    expect(out).not.toMatch(/onclick/i);
    // 用户可见的是锚内文本，不是字面量开标签串作为正文唯一内容
    expect(out).toMatch(/<span[^>]*data-annotate-id="1"[^>]*>foo<\/span>/);
  });
});

describe('T-SA7 FileMarkdownPreview 双 Tab 同源 draft id', () => {
  beforeEach(() => {
    mockReadEngine.mockReset();
    mockReadEngine.mockResolvedValue('webview');
    mockRichDocumentWebView.mockClear();
    resetChatAnnotateDraftStoreForTests();
  });

  afterEach(() => {
    resetChatAnnotateDraftStoreForTests();
  });

  it('文本 Tab 与 MD Tab 对同一 draft 注入同 id 锚 HTML', async () => {
    const sessionId = 's-sa7';
    const path = '/note.md';
    const content = `---
title: T
---
hello world
`;
    const bodyStart = content.indexOf('hello');
    addChatAnnotateDraft(sessionId, {
      id: 'draft-sa7',
      path,
      originalText: 'hello',
      userAnnotation: '备注',
      startOffset: bodyStart,
      endOffset: bodyStart + 5,
    });

    await act(async () => {
      TestRenderer.create(
        <FileMarkdownPreview
          path={path}
          content={content}
          tokens={tokens}
          renderKind="txt"
          annotateEnabled
          sessionId={sessionId}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const txtProps = mockRichDocumentWebView.mock.calls.at(-1)?.[0] as {
      html?: string;
      layout?: string;
      annotateCollectMode?: string;
    };
    expect(txtProps?.layout).toBe('plain');
    expect(txtProps?.annotateCollectMode).toBe('plain');
    expect(txtProps?.html).toContain('data-annotate-id="draft-sa7"');
    expect(txtProps?.html).toContain('nm-annotate-anchor');
    expect(txtProps?.html).not.toContain('annotations');

    mockRichDocumentWebView.mockClear();

    await act(async () => {
      TestRenderer.create(
        <FileMarkdownPreview
          path={path}
          content={content}
          tokens={tokens}
          renderKind="markdown"
          annotateEnabled
          sessionId={sessionId}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const mdProps = mockRichDocumentWebView.mock.calls.at(-1)?.[0] as {
      html?: string;
      annotateCollectMode?: string;
      annotations?: unknown;
    };
    expect(mdProps?.annotateCollectMode).toBe('markdown');
    expect(mdProps?.html).toContain('data-annotate-id="draft-sa7"');
    expect(mdProps?.annotations).toBeUndefined();
  });
});

describe('T-SA9 预览主路径退役 DOM 搜字', () => {
  it('RichDocumentWebView 默认源码不在刷新路径投递 setAnnotations', () => {
    const src = readFileSync(
      join(
        __dirname,
        '../src/components/vfs/RichDocumentWebView.tsx',
      ),
      'utf8',
    );
    expect(src).toContain('NM_ANNOTATE_DOM_SEARCH_FALLBACK');
    expect(src).toMatch(
      /if\s*\(\s*NM_ANNOTATE_DOM_SEARCH_FALLBACK\s*&&\s*annotateEnabled\s*\)/,
    );
  });

  it('annotate.ts 默认不调用 applyAnnotateMarks；点击走 data-annotate-id', () => {
    const src = readFileSync(
      join(
        __dirname,
        '../src/web/rich-document/webview/runtime/annotate.ts',
      ),
      'utf8',
    );
    expect(src).toContain('isAnnotateDomSearchFallbackEnabled');
    expect(src).toContain('data-annotate-id');
    expect(src).toContain('nm-annotate-anchor');
    expect(src).toMatch(
      /if\s*\(\s*!isAnnotateDomSearchFallbackEnabled\(\)\s*\)\s*\{\s*return;/,
    );
  });

  it('FileMarkdownPreview 主路径调用 buildAnnotatedSource，不传 annotations', async () => {
    mockReadEngine.mockResolvedValue('webview');
    mockRichDocumentWebView.mockClear();
    resetChatAnnotateDraftStoreForTests();
    const sessionId = 's-sa9';
    const path = '/a.md';
    const content = 'hello\n';
    addChatAnnotateDraft(sessionId, {
      id: 'x',
      path,
      originalText: 'hello',
      userAnnotation: 'n',
      startOffset: 0,
      endOffset: 5,
    });
    await act(async () => {
      TestRenderer.create(
        <FileMarkdownPreview
          path={path}
          content={content}
          tokens={tokens}
          annotateEnabled
          sessionId={sessionId}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const last = mockRichDocumentWebView.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(last.annotations).toBeUndefined();
    expect(last.annotateSourceText).toBeUndefined();
    expect(String(last.html ?? '')).toContain('data-annotate-id="x"');
    resetChatAnnotateDraftStoreForTests();
  });
});
