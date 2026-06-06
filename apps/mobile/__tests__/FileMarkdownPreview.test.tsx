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
  RichDocumentWebView: () => {
    const React = require('react');
    const {View} = require('react-native');
    return React.createElement(View, {testID: 'rich-document-webview'});
  },
}));

import {FileMarkdownPreview} from '../src/components/vfs/FileMarkdownPreview';

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
});
