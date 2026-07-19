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

    // chip 联动：refreshComposerAnnotateChips 由添加路径调用；此处直接断言 store→chip
    expect(chipsFromAnnotateStore(sessionId)).toHaveLength(1);
    expect(chipsFromAnnotateStore(sessionId)[0]?.action).toBe('annotate');
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
});
