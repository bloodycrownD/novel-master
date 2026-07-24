/**
 * RichDocumentWebView：Recogito MD 批注；无原生 menuItems / collect 主路径。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

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

import {RichDocumentWebView} from '../src/components/vfs/RichDocumentWebView';

describe('RichDocumentWebView annotate（无 menuItems）', () => {
  beforeEach(() => {
    mockWebViewProps.length = 0;
  });

  it('annotateEnabled=true 仍不挂 menuItems / onCustomMenuSelection', () => {
    act(() => {
      TestRenderer.create(
        <RichDocumentWebView
          html="<p>hello world</p>"
          annotateEnabled
          annotations={[
            {
              id: 'a1',
              originalText: 'hello',
              renderStart: 0,
              renderEnd: 5,
            },
          ]}
          onRecogitoCreate={jest.fn()}
        />,
      );
    });
    const last = mockWebViewProps[mockWebViewProps.length - 1];
    expect(last?.menuItems).toBeUndefined();
    expect(last?.onCustomMenuSelection).toBeUndefined();
  });

  it('annotateEnabled=false 亦不挂 menuItems', () => {
    act(() => {
      TestRenderer.create(
        <RichDocumentWebView plain="hello" annotateEnabled={false} />,
      );
    });
    const last = mockWebViewProps[mockWebViewProps.length - 1];
    expect(last?.menuItems).toBeUndefined();
  });

  it('源码无旧 menuItems / collect；含 Recogito 消息路径', () => {
    const src = readFileSync(
      join(__dirname, '../src/components/vfs/RichDocumentWebView.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/menuItems/);
    expect(src).not.toMatch(/RICH_DOCUMENT_ANNOTATE_MENU_ITEMS/);
    expect(src).not.toMatch(/__nmCollectAnnotateSelection/);
    expect(src).not.toMatch(/onAnnotateCollect/);
    expect(src).toContain('recogitoCreate');
    expect(src).toContain("type: 'setAnnotations'");
  });
});
