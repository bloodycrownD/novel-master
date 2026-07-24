/**
 * 预览划词 → store → chip 联动（组件可测部分）。
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

describe('FileMarkdownPreview annotate wiring', () => {
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

  it('annotateEnabled=true 传递 onAnnotateCollect；store 写入后 chip 联动', async () => {
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
      startOffset: content.indexOf('hello'),
      endOffset: content.indexOf('hello') + 5,
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
    expect(last?.annotateEnabled).toBe(true);
    expect(typeof last?.onAnnotateCollect).toBe('function');
    expect(last?.annotations).toBeUndefined();
    expect(String(last?.html ?? '')).toContain('data-annotate-id="a1"');

    // chip 联动：refreshComposerAnnotateChips 由添加路径调用；此处直接断言 store→chip
    expect(chipsFromAnnotateStore(sessionId)).toHaveLength(1);
    expect(chipsFromAnnotateStore(sessionId)[0]?.action).toBe('annotate');
  });

  it('草稿含 offset 时文本/MD 均注入锚（不再透传 annotations 行列）', async () => {
    const sessionId = 's-soft-range';
    const path = '/note.md';
    const content = `---
title: T
---
hello world
`;
    const start = content.indexOf('hello');
    addChatAnnotateDraft(sessionId, {
      id: 'a1',
      path,
      originalText: 'hello',
      userAnnotation: '备注',
      startOffset: start,
      endOffset: start + 5,
      startLine: 2,
      endLine: 6,
      startCol: 1,
      endCol: 5,
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
    expect(last?.annotations).toBeUndefined();
    expect(String(last?.html ?? '')).toContain('data-annotate-id="a1"');
  });

  it('同文多条均按 offset 注入（A-1 / 同源 id）', async () => {
    const sessionId = 's-same-text';
    const path = '/note.md';
    const content = `---
title: T
---
hello world hello
`;
    const first = content.indexOf('hello');
    const second = content.lastIndexOf('hello');
    addChatAnnotateDraft(sessionId, {
      id: 'a1',
      path,
      originalText: 'hello',
      userAnnotation: '一',
      startOffset: first,
      endOffset: first + 5,
    });
    addChatAnnotateDraft(sessionId, {
      id: 'a2',
      path,
      originalText: 'hello',
      userAnnotation: '二',
      startOffset: second,
      endOffset: second + 5,
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
    const html = String(last?.html ?? '');
    expect(html).toContain('data-annotate-id="a1"');
    expect(html).toContain('data-annotate-id="a2"');
  });

  it('txt + annotateEnabled 走 WebView 认锚 html（layout=plain）', async () => {
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
    const last = mockRichDocumentWebView.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(last?.annotateEnabled).toBe(true);
    expect(last?.layout).toBe('plain');
    expect(last?.annotateCollectMode).toBe('plain');
    expect(typeof last?.html === 'string' || last?.plain === 'plain text body').toBe(
      true,
    );
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

  it('T-UL1: 同 session 两 path 草稿，切换 preview 时仅当前 path 锚进 html', async () => {
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
      startOffset: contentA.indexOf('alpha'),
      endOffset: contentA.indexOf('alpha') + 5,
    });
    addChatAnnotateDraft(sessionId, {
      id: 'db',
      path: pathB,
      originalText: 'beta',
      userAnnotation: '批B',
      startOffset: contentB.indexOf('beta'),
      endOffset: contentB.indexOf('beta') + 4,
    });

    let root: TestRenderer.ReactTestRenderer;
    await act(async () => {
      root = TestRenderer.create(
        <FileMarkdownPreview
          path={pathA}
          content={contentA}
          tokens={tokens}
          annotateEnabled
          sessionId={sessionId}
        />,
      );
    });

    const propsA = mockRichDocumentWebView.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(String(propsA?.html ?? '')).toContain('data-annotate-id="da"');
    expect(String(propsA?.html ?? '')).not.toContain('data-annotate-id="db"');

    mockRichDocumentWebView.mockClear();

    await act(async () => {
      root!.update(
        <FileMarkdownPreview
          path={pathB}
          content={contentB}
          tokens={tokens}
          annotateEnabled
          sessionId={sessionId}
        />,
      );
    });

    const propsB = mockRichDocumentWebView.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(String(propsB?.html ?? '')).toContain('data-annotate-id="db"');
    expect(String(propsB?.html ?? '')).not.toContain('data-annotate-id="da"');
  });
});
