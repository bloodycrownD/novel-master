/**
 * CodeEditorWebView 的回环断路器用例（长按连删卡顿修，2026-10-01）。
 *
 * 病灶回顾：web 上行 change → onChange → 父层 value 流回 → 下行
 * setDocument 全文替换——滞后镜像把刚删的字吃回来，长按连删时正反馈越卡
 * 越回滚。断路器（lastUpstreamRef）让镜像原样流回时不下行。
 * 锁三条：①镜像流回零下行；②真外部写入照常下行；③只换 path 时照常下行。
 */
import React from 'react';
import {describe, expect, it, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

const mockWebViewPostMessages: string[] = [];

jest.mock('react-native-webview', () => {
  const ReactModule = require('react');
  // mock ref 暴露 postMessage（RN WebView ref 的真实 API 面），收集下行；
  // onMessage 经组件 props 由测试直接调用（simulateUpstream）。
  const MockWebView = ReactModule.forwardRef(
    (
      _props: {onMessage?: (event: unknown) => void},
      ref: {current: unknown},
    ) => {
      ReactModule.useImperativeHandle(ref, () => ({
        postMessage: (data: string) => {
          mockWebViewPostMessages.push(data);
        },
        injectJavaScript: () => true,
      }));
      return ReactModule.createElement('MockWebView', null);
    },
  );
  return {__esModule: true, default: MockWebView};
});

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({tokens: {background: '#fff'}}),
}));

import {CodeEditorWebView} from '@/components/vfs/CodeEditorWebView';

function renderTree(
  value: string,
  onChange: (text: string) => void,
  path = 'notes/a.md',
): TestRenderer.ReactTestRenderer {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <CodeEditorWebView value={value} path={path} onChange={onChange} />,
    );
  });
  return tree;
}

function webViewNode(
  tree: TestRenderer.ReactTestRenderer,
): TestRenderer.ReactTestInstance {
  return tree.root.findByType(
    (require('react-native-webview').default as unknown) as React.ComponentType,
  );
}

function simulateUpstream(
  tree: TestRenderer.ReactTestRenderer,
  type: string,
  payload: Record<string, unknown>,
): void {
  act(() => {
    webViewNode(tree).props.onMessage?.({
      nativeEvent: {data: JSON.stringify({v: 1, type, payload})},
    });
  });
}

function setDocumentCount(): number {
  return mockWebViewPostMessages.filter(raw => {
    try {
      return (JSON.parse(raw) as {type?: string}).type === 'setDocument';
    } catch {
      return false;
    }
  }).length;
}

describe('CodeEditorWebView · 回环断路器（lastUpstreamRef）', () => {
  afterEach(() => {
    mockWebViewPostMessages.length = 0;
  });

  it('上行 change 的镜像流回不触发下行 setDocument；外部写入照常下行', async () => {
    let value = 'initial';
    const onChange = jest.fn((text: string) => {
      value = text;
    });
    const tree = renderTree(value, onChange);

    // ready 握手 → 首发下行（水合）
    simulateUpstream(tree, 'ready', {version: 'u1'});
    await act(async () => {
      await Promise.resolve();
    });
    const baseCount = setDocumentCount();
    expect(baseCount).toBeGreaterThanOrEqual(1);

    // 上行 change：'initial' → 'ini'
    simulateUpstream(tree, 'change', {text: 'ini'});
    await act(async () => {
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith('ini');

    // 镜像流回（父层 state 已采纳上行值）：断路器命中，零新增下行
    act(() => {
      tree.update(
        <CodeEditorWebView
          value={value}
          path="notes/a.md"
          onChange={onChange}
        />,
      );
    });
    expect(setDocumentCount()).toBe(baseCount);

    // 真外部写入（与上行镜像不同值）：照常下行
    act(() => {
      tree.update(
        <CodeEditorWebView
          value="external rewrite"
          path="notes/a.md"
          onChange={onChange}
        />,
      );
    });
    expect(setDocumentCount()).toBe(baseCount + 1);
  });

  // cr2-A-1 活例：同实例换 path 而草稿未变。旧断路器只比 value，会把这次切换
  // 当成镜像流回吞掉下行，web 侧 currentPath 停旧文件，composer 胶囊扩展失效。
  it('path 变而 value 不变时仍下行 setDocument（换 path 不得被断路器吞掉）', async () => {
    const value = 'same draft';
    const onChange = jest.fn((text: string) => {
      void text;
    });
    const tree = renderTree(value, onChange, 'notes/a.md');

    simulateUpstream(tree, 'ready', {version: 'u1'});
    await act(async () => {
      await Promise.resolve();
    });
    const baseCount = setDocumentCount();
    expect(baseCount).toBeGreaterThanOrEqual(1);

    // 上行一次 change（内容与当前 value 相同）：断路器基线落到这份 text + a.md，
    // 构造出「下一帧只有 path 变了」的精确活例。
    simulateUpstream(tree, 'change', {text: value});
    await act(async () => {
      await Promise.resolve();
    });
    expect(setDocumentCount()).toBe(baseCount);

    // 换 path、value 不变：必须补一次下行。
    act(() => {
      tree.update(
        <CodeEditorWebView
          value={value}
          path="notes/b.md"
          onChange={onChange}
        />,
      );
    });
    expect(setDocumentCount()).toBe(baseCount + 1);
  });
});
