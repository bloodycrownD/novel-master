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

describe('RichDocumentWebView 暗色白闪 C′+E（T-PF5/T-PF6）', () => {
  beforeEach(() => {
    mockWebViewProps.length = 0;
  });

  // T-PF5：C′ 链路——source.uri 追加 `?bg=` + encodeURIComponent(tokens.background)，
  // 供 index.html head 内联 bootstrap 首绘前同步写 --bg（B 在 Android 是异步注入、
  // 输给首绘，故 URI 参数是确定性通道）。mock background='#fff'、surface='#f2f2f7'
  // 编码值不同，断言等值即同时排除误用 surface（同 T-PF1 口径，RULE #17）。
  it('T-PF5：WebView source.uri 携带 ?bg= 编码参数', () => {
    act(() => {
      TestRenderer.create(<RichDocumentWebView plain="hello" />);
    });
    const last = mockWebViewProps[mockWebViewProps.length - 1];
    const source = last?.source as {uri?: string} | undefined;
    expect(source?.uri).toBe(
      `file:///rich-document/index.html?bg=${encodeURIComponent('#fff')}`,
    );
    expect(source?.uri?.endsWith('?bg=%23fff')).toBe(true);
    expect(source?.uri).not.toContain(encodeURIComponent('#f2f2f7'));
  });

  // T-PF6：E 遮罩——初始（!webReady）渲染绝对定位盖层、底色 tokens.background；
  // web 侧 ready 上报后（handleMessage setWebReady(true)）遮罩不再渲染。
  it('T-PF6：ready 前渲染 flash-cover 遮罩、ready 后消失', () => {
    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(<RichDocumentWebView plain="hello" />);
    });
    const findAllCovers = () =>
      tree!.root.findAll(
        node =>
          // 只认 host 实例（composite View 与其 host 节点同 props，会重复命中）
          typeof node.type === 'string' &&
          node.props?.testID === 'rich-document-flash-cover',
      );
    const covers = findAllCovers();
    expect(covers).toHaveLength(1);
    const flat = StyleSheet.flatten(
      covers[0]?.props?.style as never,
    ) as Record<string, unknown>;
    expect(flat).toEqual(
      expect.objectContaining({
        position: 'absolute',
        backgroundColor: '#fff',
      }),
    );
    const last = mockWebViewProps[mockWebViewProps.length - 1];
    act(() => {
      (
        last?.onMessage as (event: {
          nativeEvent: {data: string};
        }) => void
      )({
        nativeEvent: {
          data: JSON.stringify({v: 1, type: 'ready', payload: {version: 1}}),
        },
      });
    });
    expect(findAllCovers()).toHaveLength(0);
  });
});
