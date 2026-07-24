/**
 * T-SA6：sanitize 仍允许历史锚属性（兼容存量 HTML）；预览主路径已改 Recogito。
 * T-SA7 / T-SA9：改为 Recogito 合同（干净 HTML + annotations 投影；plain 无批注）。
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

describe('T-SA6 Mobile sanitize / 认锚 HTML（存量兼容）', () => {
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
    expect(out).toMatch(/<span[^>]*data-annotate-id="1"[^>]*>foo<\/span>/);
  });
});

describe('T-SA7 FileMarkdownPreview MD Recogito / plain 禁用', () => {
  beforeEach(() => {
    mockReadEngine.mockReset();
    mockReadEngine.mockResolvedValue('webview');
    mockRichDocumentWebView.mockClear();
    resetChatAnnotateDraftStoreForTests();
  });

  afterEach(() => {
    resetChatAnnotateDraftStoreForTests();
  });

  it('文本 Tab 不挂 WebView 批注；MD Tab 干净 HTML + annotations 投影', async () => {
    const sessionId = 's-sa7';
    const path = '/note.md';
    const content = `---
title: T
---
hello world
`;
    addChatAnnotateDraft(sessionId, {
      id: 'draft-sa7',
      path,
      originalText: 'hello',
      userAnnotation: '备注',
      renderStart: 0,
      renderEnd: 5,
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
    expect(mockRichDocumentWebView.mock.calls.length).toBe(0);

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
      annotations?: {id: string}[];
      annotateEnabled?: boolean;
    };
    expect(mdProps?.annotateEnabled).toBe(true);
    expect(mdProps?.html).not.toContain('data-annotate-id');
    expect(mdProps?.annotations?.[0]?.id).toBe('draft-sa7');
  });
});

describe('T-SA9 预览主路径无 DOM 搜字 / 无插锚', () => {
  it('RichDocumentWebView 无 fallback 开关；annotate 时投递 setAnnotations', () => {
    const src = readFileSync(
      join(
        __dirname,
        '../src/components/vfs/RichDocumentWebView.tsx',
      ),
      'utf8',
    );
    expect(src).not.toContain('NM_ANNOTATE_DOM_SEARCH_FALLBACK');
    expect(src).toContain("type: 'setAnnotations'");
    expect(src).toContain('annotations');
    expect(src).not.toContain('createTextAnnotator'); // Recogito 在 WebView annotate.ts
  });

  it('annotate.ts 使用 createTextAnnotator，不调用 applyAnnotateMarks', () => {
    const src = readFileSync(
      join(
        __dirname,
        '../src/web/rich-document/webview/runtime/annotate.ts',
      ),
      'utf8',
    );
    expect(src).toContain('createTextAnnotator');
    expect(src).not.toMatch(/applyAnnotateMarks\s*\(|from\s+['"][^'"]*annotate-marks/);
    expect(src).not.toContain('isAnnotateDomSearchFallbackEnabled');
  });

  it('FileMarkdownPreview 主路径不插锚，经 annotations 投影', async () => {
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
      renderStart: 0,
      renderEnd: 5,
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
    expect(last.annotations).toEqual([
      {
        id: 'x',
        originalText: 'hello',
        renderStart: 0,
        renderEnd: 5,
      },
    ]);
    expect(String(last.html ?? '')).not.toContain('data-annotate-id="x"');
    resetChatAnnotateDraftStoreForTests();
  });
});
