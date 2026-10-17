/**
 * RichDocumentWebView：MD 批注 = 原生「复制/批注」菜单 + Recogito 仅投影。
 */
import React from 'react';
import {StyleSheet} from 'react-native';
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

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {setString: jest.fn()},
}));

jest.mock('@/webview-host/rich-document/uri', () => ({
  getRichDocumentUri: () => 'file:///rich-document/index.html',
  getRichDocumentPackageDirUri: () => 'file:///rich-document/',
}));

// mermaid 全屏返回键自注册用（组件不在 NavigationContainer 内渲染；聚焦恒真即可）
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({isFocused: () => true}),
  useFocusEffect: () => {},
}));

jest.mock('@/theme/ThemeProvider', () => ({
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

import {
  RICH_DOCUMENT_ANNOTATE_MENU_ITEMS,
  RichDocumentWebView,
} from '@/components/vfs/RichDocumentWebView';

describe('RichDocumentWebView annotate（原生菜单 + Recogito 投影）', () => {
  beforeEach(() => {
    mockWebViewProps.length = 0;
  });

  it('annotateEnabled=true 挂 复制/批注 menuItems', () => {
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
    expect(last?.menuItems).toEqual([...RICH_DOCUMENT_ANNOTATE_MENU_ITEMS]);
    expect(typeof last?.onCustomMenuSelection).toBe('function');
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

  it('源码：菜单批注 + inject Recogito 采集；无划词即 createAnnotation', () => {
    const web = readFileSync(
      join(__dirname, '../src/components/vfs/RichDocumentWebView.tsx'),
      'utf8',
    );
    const annotate = readFileSync(
      join(__dirname, '../src/web/rich-document/webview/runtime/annotate.ts'),
      'utf8',
    );
    expect(web).toMatch(/menuItems/);
    expect(web).toMatch(/RICH_DOCUMENT_ANNOTATE_MENU_ITEMS/);
    expect(web).toMatch(/__nmCollectRecogitoSelection/);
    expect(web).toContain('recogitoCreate');
    expect(annotate).toMatch(/annotatingEnabled:\s*false/);
    expect(annotate).not.toMatch(/\.on\(\s*['\"]createAnnotation['\"]/);
  });
});

describe('RichDocumentWebView 暗色白闪 A+B（T-PF1/T-PF2）', () => {
  beforeEach(() => {
    mockWebViewProps.length = 0;
  });

  // T-PF1：mock 主题 background='#fff'、surface='#f2f2f7' 取值不同——
  // 断言等于 background 即同时排除误用 surface（RULE #17 颜色映射陷阱）。
  it('T-PF1：WebView 本体 style 含 tokens.background 底色', () => {
    act(() => {
      TestRenderer.create(<RichDocumentWebView plain="hello" />);
    });
    const last = mockWebViewProps[mockWebViewProps.length - 1];
    const flat = StyleSheet.flatten(last?.style as never) as Record<
      string,
      unknown
    >;
    expect(flat).toEqual(expect.objectContaining({backgroundColor: '#fff'}));
    expect(flat?.backgroundColor).not.toBe('#f2f2f7');
  });

  // T-PF2：锁注入串形态——IIFE + documentElement null 防护 + 只写 --bg，
  // 值为当前主题 background（JSON.stringify 拼入）。
  it('T-PF2：injectedJavaScriptBeforeContentLoaded 预注入 --bg', () => {
    act(() => {
      TestRenderer.create(<RichDocumentWebView plain="hello" />);
    });
    const last = mockWebViewProps[mockWebViewProps.length - 1];
    const script = String(last?.injectedJavaScriptBeforeContentLoaded ?? '');
    expect(script.startsWith('(function(){')).toBe(true);
    expect(script).toContain('document.documentElement');
    expect(script).toContain('if(!el)');
    expect(script).toContain('catch');
    expect(script).toContain(`'--bg'`);
    expect(script).toContain(JSON.stringify('#fff'));
    // 只注入 --bg：其余变量等 init 后 applyHostTheme 写，不参与首帧白窗。
    expect(script.match(/setProperty\(/g)).toHaveLength(1);
    expect(script).not.toContain('--surface');
  });
});
