/**
 * T-RG2–T-RG5：Recogito 预览合同（源码契约 + 映射函数）。
 */
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import React from 'react';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
  draftToRecogitoAnnotation,
  draftsToRecogitoAnnotations,
  recogitoAnnotationToDraftFields,
} from '../src/web/rich-document/webview/runtime/annotate-recogito-map';
import {
  addChatAnnotateDraft,
  resetChatAnnotateDraftStoreForTests,
} from '../src/storage/chat-annotate-draft';

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
  sanitizeRichHtml: (html: string) => html,
}));

jest.mock('../src/components/rich-content/prepare-transcript-rich-html', () => ({
  prepareTranscriptRichHtml: (md: string) => `<div class="clean">${md}</div>`,
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

function readSrc(relFromSrc: string): string {
  return readFileSync(
    join(__dirname, '..', 'src', relFromSrc),
    'utf8',
  );
}

describe('T-RG2 无插锚预览主路径', () => {
  it('FileMarkdownPreview 不 import/调用 buildAnnotatedSource', () => {
    const src = readSrc('components/vfs/FileMarkdownPreview.tsx');
    expect(src).not.toMatch(
      /from\s+['"][^'"]*buildAnnotatedSource|buildAnnotatedSource\s*\(/,
    );
    expect(src).not.toMatch(/\bbuildAnnotatedSource\b/);
  });

  it('RichDocumentWebView 无 DOM 搜字 fallback 开关', () => {
    const src = readSrc('components/vfs/RichDocumentWebView.tsx');
    expect(src).not.toMatch(/NM_ANNOTATE_DOM_SEARCH_FALLBACK/);
    expect(src).not.toMatch(/setNmAnnotateDomSearchFallbackForTests/);
    expect(src).not.toMatch(/setPreviewAnnotateDomSearchFallbackForTests/);
  });

  it('annotate.ts 不走 applyAnnotateMarks / __NM_ANNOTATE_DOM_SEARCH_FALLBACK__', () => {
    const src = readSrc('web/rich-document/webview/runtime/annotate.ts');
    expect(src).not.toMatch(/applyAnnotateMarks\s*\(|from\s+['"][^'"]*annotate-marks/);
    expect(src).not.toMatch(/__NM_ANNOTATE_DOM_SEARCH_FALLBACK__/);
    expect(src).not.toMatch(/isAnnotateDomSearchFallbackEnabled/);
  });

  it('MD 预览 html 为干净渲染，不含 nm-annotate-anchor', async () => {
    mockReadEngine.mockResolvedValue('webview');
    mockRichDocumentWebView.mockClear();
    resetChatAnnotateDraftStoreForTests();
    const sessionId = 's-rg2';
    const path = '/a.md';
    const content = 'hello world\n';
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
    expect(String(last.html ?? '')).toContain('hello world');
    expect(String(last.html ?? '')).not.toContain('nm-annotate-anchor');
    expect(String(last.html ?? '')).not.toContain('data-annotate-id');
    resetChatAnnotateDraftStoreForTests();
  });
});

describe('T-RG3 Mobile Recogito 初始化与草稿映射接线', () => {
  it('annotate.ts / main.ts 含 createTextAnnotator、annotatingEnabled=false 与 destroy', () => {
    const annotate = readSrc('web/rich-document/webview/runtime/annotate.ts');
    const main = readSrc('web/rich-document/webview/main.ts');
    expect(annotate).toContain('createTextAnnotator');
    expect(annotate).toMatch(/annotatingEnabled:\s*false/);
    expect(annotate).toContain('setAnnotations');
    expect(annotate).toContain('destroy');
    expect(annotate).toContain('draftsToRecogitoAnnotations');
    expect(annotate).not.toMatch(/\.on\(\s*['\"]createAnnotation['\"]/);
    expect(main).toContain('refreshAnnotateAfterDocument');
    expect(main).toContain('destroyAnnotator');
  });

  it('MD annotateEnabled 向 WebView 传 annotations（render 坐标）', async () => {
    mockReadEngine.mockResolvedValue('webview');
    mockRichDocumentWebView.mockClear();
    resetChatAnnotateDraftStoreForTests();
    const sessionId = 's-rg3';
    const path = '/note.md';
    const content = `---
title: T
---
hello world
`;
    addChatAnnotateDraft(sessionId, {
      id: 'a1',
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
          renderKind="markdown"
          annotateEnabled
          sessionId={sessionId}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const last = mockRichDocumentWebView.mock.calls.at(-1)?.[0] as {
      annotateEnabled?: boolean;
      annotations?: {id: string; renderStart: number; renderEnd: number}[];
      onRecogitoCreate?: unknown;
    };
    expect(last.annotateEnabled).toBe(true);
    expect(typeof last.onRecogitoCreate).toBe('function');
    expect(last.annotations).toEqual([
      {
        id: 'a1',
        originalText: 'hello',
        renderStart: 0,
        renderEnd: 5,
      },
    ]);
    resetChatAnnotateDraftStoreForTests();
  });
});

describe('T-RG4 plain 无批注', () => {
  beforeEach(() => {
    mockReadEngine.mockReset();
    mockReadEngine.mockResolvedValue('webview');
    mockRichDocumentWebView.mockClear();
    resetChatAnnotateDraftStoreForTests();
  });

  afterEach(() => {
    resetChatAnnotateDraftStoreForTests();
  });

  it('txt Tab 即使 annotateEnabled 也不挂 RichDocumentWebView / Recogito', async () => {
    const sessionId = 's-rg4';
    addChatAnnotateDraft(sessionId, {
      id: 'a1',
      path: '/note.md',
      originalText: 'hello',
      userAnnotation: 'x',
      renderStart: 0,
      renderEnd: 5,
    });
    await act(async () => {
      TestRenderer.create(
        <FileMarkdownPreview
          path="/note.md"
          content={'hello\n'}
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
  });

  it('FileMarkdownPreview 源码：txt 分支不传 annotate / 无 collect', () => {
    const src = readSrc('components/vfs/FileMarkdownPreview.tsx');
    expect(src).toMatch(/plain\/文本 Tab：禁用批注/);
    expect(src).not.toMatch(/annotateCollectMode/);
    expect(src).not.toMatch(/onAnnotateCollect/);
  });

  it('RichDocumentWebView 挂 复制/批注菜单；划词不自动建批注', () => {
    const src = readSrc('components/vfs/RichDocumentWebView.tsx');
    const annotate = readSrc(
      'web/rich-document/webview/runtime/annotate.ts',
    );
    expect(src).toMatch(/menuItems/);
    expect(src).toMatch(/RICH_DOCUMENT_ANNOTATE_MENU_ITEMS/);
    expect(src).toMatch(/__nmCollectRecogitoSelection/);
    expect(annotate).toMatch(/annotatingEnabled:\s*false/);
  });
});

describe('T-RG5 Recogito ↔ draft 字段映射', () => {
  it('draftToRecogitoAnnotation 写出 quote/start/end', () => {
    const ann = draftToRecogitoAnnotation({
      id: 'd1',
      originalText: 'muse',
      renderStart: 48,
      renderEnd: 52,
    });
    expect(ann.id).toBe('d1');
    expect(ann.target.selector[0]).toEqual({
      quote: 'muse',
      start: 48,
      end: 52,
    });
  });

  it('recogitoAnnotationToDraftFields 读回一致', () => {
    const fields = recogitoAnnotationToDraftFields({
      id: 'tmp-1',
      target: {
        selector: [{quote: 'Tell me', start: 10, end: 17}],
      },
    });
    expect(fields).toEqual({
      id: 'tmp-1',
      originalText: 'Tell me',
      renderStart: 10,
      renderEnd: 17,
    });
  });

  it('非法区间返回 null；缺 render 坐标的草稿不投影', () => {
    expect(
      recogitoAnnotationToDraftFields({
        id: 'x',
        target: {selector: [{quote: 'a', start: 5, end: 5}]},
      }),
    ).toBeNull();
    expect(
      draftsToRecogitoAnnotations([
        {id: 'old', originalText: 'a', renderStart: undefined, renderEnd: undefined},
        {id: 'ok', originalText: 'hi', renderStart: 0, renderEnd: 2},
      ]),
    ).toEqual([
      draftToRecogitoAnnotation({
        id: 'ok',
        originalText: 'hi',
        renderStart: 0,
        renderEnd: 2,
      }),
    ]);
  });
});
