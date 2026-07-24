/**
 * 预览批注接线：Recogito MD-only（annotations 投影；plain 禁用；无插锚 HTML）。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {
  addChatAnnotateDraft,
  chipsFromAnnotateStore,
  resetChatAnnotateDraftStoreForTests,
} from '../src/storage/chat-annotate-draft';
import {
  readChatComposerDraftState,
  refreshComposerAnnotateChips,
} from '../src/storage/chat-composer-draft';

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
      annotateEnabled: props.annotateEnabled,
      annotations: props.annotations,
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
  prepareTranscriptRichHtml: (md: string) => `<div>${md}</div>`,
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

describe('FileMarkdownPreview annotate wiring (Recogito MD-only)', () => {
  beforeEach(() => {
    mockReadEngine.mockReset();
    mockReadEngine.mockResolvedValue('webview');
    mockRichDocumentWebView.mockClear();
    resetChatAnnotateDraftStoreForTests();
  });

  afterEach(() => {
    resetChatAnnotateDraftStoreForTests();
  });

  it('annotateEnabled=false 不传批注 props', async () => {
    const content = `---
title: T
---
body here
`;
    await act(async () => {
      TestRenderer.create(
        <FileMarkdownPreview
          path="/n.md"
          content={content}
          tokens={tokens}
          annotateEnabled={false}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const last = mockRichDocumentWebView.mock.calls.at(-1)?.[0];
    expect(last?.annotateEnabled).toBe(false);
  });

  it('MD annotateEnabled 传 annotations + onRecogitoCreate；html 无插锚；chip 可联动', async () => {
    const sessionId = 's-preview-ann';
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

    const last = mockRichDocumentWebView.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(last?.annotateEnabled).toBe(true);
    expect(typeof last?.onRecogitoCreate).toBe('function');
    expect(last?.onAnnotateCollect).toBeUndefined();
    expect(last?.annotations).toEqual([
      {
        id: 'a1',
        originalText: 'hello',
        renderStart: 0,
        renderEnd: 5,
      },
    ]);
    expect(String(last?.html ?? '')).not.toContain('data-annotate-id');
    expect(String(last?.html ?? '')).not.toContain('nm-annotate-anchor');

    expect(chipsFromAnnotateStore(sessionId)).toHaveLength(1);
    expect(chipsFromAnnotateStore(sessionId)[0]?.action).toBe('annotate');
  });

  it('缺 render 坐标的草稿不投影到 annotations', async () => {
    const sessionId = 's-no-render';
    const path = '/note.md';
    const content = `---
title: T
---
hello world
`;
    addChatAnnotateDraft(sessionId, {
      id: 'legacy',
      path,
      originalText: 'hello',
      userAnnotation: '旧稿',
      startOffset: content.indexOf('hello'),
      endOffset: content.indexOf('hello') + 5,
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

    const last = mockRichDocumentWebView.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(last?.annotateEnabled).toBe(true);
    expect(last?.annotations).toEqual([]);
    expect(String(last?.html ?? '')).not.toContain('data-annotate-id');
  });

  it('同文多条均按 render 坐标投影（同源 id）', async () => {
    const sessionId = 's-same-text';
    const path = '/note.md';
    const content = `---
title: T
---
hello world hello
`;
    addChatAnnotateDraft(sessionId, {
      id: 'a1',
      path,
      originalText: 'hello',
      userAnnotation: '一',
      renderStart: 0,
      renderEnd: 5,
    });
    addChatAnnotateDraft(sessionId, {
      id: 'a2',
      path,
      originalText: 'hello',
      userAnnotation: '二',
      renderStart: 12,
      renderEnd: 17,
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
      annotations?: {id: string}[];
      html?: string;
    };
    expect(last?.annotations?.map(a => a.id)).toEqual(['a1', 'a2']);
    expect(String(last?.html ?? '')).not.toContain('data-annotate-id');
  });

  it('txt + annotateEnabled 不挂 RichDocumentWebView（plain 禁用批注）', async () => {
    await act(async () => {
      TestRenderer.create(
        <FileMarkdownPreview
          path="/a.txt"
          content="plain text body"
          tokens={tokens}
          renderKind="txt"
          annotateEnabled
          sessionId="s-txt"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockRichDocumentWebView.mock.calls.length).toBe(0);
  });

  it('写入 annotate store 后 refreshComposerAnnotateChips 合并进状态条', () => {
    const sessionId = 's-sel-chip';
    const path = '/c.md';
    addChatAnnotateDraft(sessionId, {
      id: 'from-sel',
      path,
      originalText: 'alpha',
      userAnnotation: 'ok',
    });
    refreshComposerAnnotateChips(sessionId);

    expect(chipsFromAnnotateStore(sessionId)).toHaveLength(1);
    expect(
      readChatComposerDraftState(sessionId).attachments.some(
        a => a.action === 'annotate' && a.path === path,
      ),
    ).toBe(true);
  });

  it('T-UL1: 同 session 两 path 草稿，切换 preview 时仅当前 path 进 annotations', async () => {
    const sessionId = 's-ul1-multi-path';
    const pathA = '/a.md';
    const pathB = '/b.md';
    const contentA = `---
title: A
---
alpha text
`;
    const contentB = `---
title: B
---
beta text
`;
    addChatAnnotateDraft(sessionId, {
      id: 'da',
      path: pathA,
      originalText: 'alpha',
      userAnnotation: '批A',
      renderStart: 0,
      renderEnd: 5,
    });
    addChatAnnotateDraft(sessionId, {
      id: 'db',
      path: pathB,
      originalText: 'beta',
      userAnnotation: '批B',
      renderStart: 0,
      renderEnd: 4,
    });

    let root: TestRenderer.ReactTestRenderer;
    await act(async () => {
      root = TestRenderer.create(
        <FileMarkdownPreview
          path={pathA}
          content={contentA}
          tokens={tokens}
          renderKind="markdown"
          annotateEnabled
          sessionId={sessionId}
        />,
      );
    });

    const propsA = mockRichDocumentWebView.mock.calls.at(-1)?.[0] as {
      annotations?: {id: string}[];
      html?: string;
    };
    expect(propsA?.annotations?.map(a => a.id)).toEqual(['da']);
    expect(String(propsA?.html ?? '')).not.toContain('data-annotate-id="db"');

    mockRichDocumentWebView.mockClear();

    await act(async () => {
      root!.update(
        <FileMarkdownPreview
          path={pathB}
          content={contentB}
          tokens={tokens}
          renderKind="markdown"
          annotateEnabled
          sessionId={sessionId}
        />,
      );
    });

    const propsB = mockRichDocumentWebView.mock.calls.at(-1)?.[0] as {
      annotations?: {id: string}[];
    };
    expect(propsB?.annotations?.map(a => a.id)).toEqual(['db']);
  });
});
