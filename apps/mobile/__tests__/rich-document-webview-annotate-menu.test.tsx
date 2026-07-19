/**
 * RichDocumentWebView：划词批注时挂原生选区菜单「添加批注」。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

const mockWebViewProps: Array<Record<string, unknown>> = [];

jest.mock('react-native-webview', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      mockWebViewProps.push(props);
      return React.createElement(View, {testID: 'webview'});
    },
  };
});

jest.mock('@/webview-host/rich-document/uri', () => ({
  getRichDocumentUri: () => 'file:///rich-document/index.html',
  getRichDocumentPackageDirUri: () => 'file:///rich-document/',
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {setString: jest.fn()},
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      text: '#111',
      textSecondary: '#666',
      primary: '#007aff',
      surface: '#f2f2f7',
      borderLight: '#eee',
    },
  }),
}));

import Clipboard from '@react-native-clipboard/clipboard';
import {
  RICH_DOCUMENT_ANNOTATE_MENU_ITEMS,
  RichDocumentWebView,
} from '../src/components/vfs/RichDocumentWebView';

describe('RichDocumentWebView annotate menuItems', () => {
  beforeEach(() => {
    mockWebViewProps.length = 0;
    (Clipboard.setString as jest.Mock).mockClear();
  });

  it('annotateEnabled=false 不挂 menuItems', () => {
    act(() => {
      TestRenderer.create(
        <RichDocumentWebView plain="hello" annotateEnabled={false} />,
      );
    });
    const last = mockWebViewProps[mockWebViewProps.length - 1];
    expect(last?.menuItems).toBeUndefined();
  });

  it('annotateEnabled=true 挂「批注」「复制」；批注回调 / 复制写剪贴板', () => {
    const onSelectionAnnotate = jest.fn();
    act(() => {
      TestRenderer.create(
        <RichDocumentWebView
          plain="hello world"
          annotateEnabled
          onSelectionAnnotate={onSelectionAnnotate}
        />,
      );
    });
    const last = mockWebViewProps[mockWebViewProps.length - 1];
    expect(last?.menuItems).toEqual([...RICH_DOCUMENT_ANNOTATE_MENU_ITEMS]);
    const handler = last?.onCustomMenuSelection as
      | ((e: {nativeEvent: {key: string; selectedText: string}}) => void)
      | undefined;
    expect(typeof handler).toBe('function');
    handler?.({
      nativeEvent: {key: 'annotate', selectedText: '  hello  '},
    });
    expect(onSelectionAnnotate).toHaveBeenCalledWith('hello');
    handler?.({
      nativeEvent: {key: 'copy', selectedText: '  world  '},
    });
    expect(Clipboard.setString).toHaveBeenCalledWith('world');
  });
});
