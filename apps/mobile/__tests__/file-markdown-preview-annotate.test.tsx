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

  it('annotateEnabled=true 传递 annotations；store 写入后 chip 联动', async () => {
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

    const last = mockRichDocumentWebView.mock.calls.at(-1)?.[0];
    expect(last?.annotateEnabled).toBe(true);
    expect(last?.annotations).toEqual([
      {id: 'a1', originalText: 'hello'},
    ]);
    expect(last?.annotateSourceText).toBe(content);

    // chip 联动：refreshComposerAnnotateChips 由添加路径调用；此处直接断言 store→chip
    expect(chipsFromAnnotateStore(sessionId)).toHaveLength(1);
    expect(chipsFromAnnotateStore(sessionId)[0]?.action).toBe('annotate');
  });

  it('草稿含宽松行列时 annotations 透传 startLine/endLine', async () => {
    const sessionId = 's-soft-range';
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

    const last = mockRichDocumentWebView.mock.calls.at(-1)?.[0];
    expect(last?.annotations).toEqual([
      {
        id: 'a1',
        originalText: 'hello',
        startLine: 2,
        endLine: 6,
        startCol: 1,
        endCol: 5,
      },
    ]);
  });

  it('同文多条 annotations 均传入 WebView（A-1）', async () => {
    const sessionId = 's-same-text';
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
      userAnnotation: '一',
    });
    addChatAnnotateDraft(sessionId, {
      id: 'a2',
      path,
      originalText: 'hello',
      userAnnotation: '二',
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

    const last = mockRichDocumentWebView.mock.calls.at(-1)?.[0];
    expect(last?.annotations).toEqual([
      {id: 'a1', originalText: 'hello'},
      {id: 'a2', originalText: 'hello'},
    ]);
  });

  it('txt + annotateEnabled 走 WebView plain（md/txt 同验收）', async () => {
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
    const last = mockRichDocumentWebView.mock.calls.at(-1)?.[0];
    expect(last?.annotateEnabled).toBe(true);
    expect(last?.plain).toBe('plain text body');
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

  it('T-UL1: 同 session 两 path 草稿，切换 preview 时 annotations 仅为当前 path 且非空', async () => {
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
    });
    addChatAnnotateDraft(sessionId, {
      id: 'db',
      path: pathB,
      originalText: 'beta',
      userAnnotation: '批B',
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

    // 同步派生：首帧即应为当前 path，无需再等 effect 一拍
    const propsA = mockRichDocumentWebView.mock.calls.at(-1)?.[0];
    expect(propsA?.annotations).toEqual([
      {id: 'da', originalText: 'alpha'},
    ]);
    expect(propsA?.annotations?.length).toBeGreaterThan(0);

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

    // 切换后同帧：仅 B 的草稿，非空，不得残留 A
    const callsAfterSwitch = mockRichDocumentWebView.mock.calls.map(
      c => c[0]?.annotations,
    );
    for (const annotations of callsAfterSwitch) {
      expect(annotations).toEqual([{id: 'db', originalText: 'beta'}]);
      expect(annotations).not.toEqual([]);
      expect(
        (annotations as {id: string}[] | undefined)?.some(a => a.id === 'da'),
      ).toBe(false);
    }
    const propsB = mockRichDocumentWebView.mock.calls.at(-1)?.[0];
    expect(propsB?.annotations).toEqual([
      {id: 'db', originalText: 'beta'},
    ]);
  });
});
